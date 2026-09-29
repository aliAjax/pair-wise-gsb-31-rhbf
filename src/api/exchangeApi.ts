import { ExchangeConflictReason, EXCHANGE_ACTION_FLOW, ExchangeStatus } from '@/constants/exchange';
import { ItemStatus } from '@/constants/item';
import type { Exchange, ExchangeConflictResult, ExchangeDraft } from '@/models/exchange';
import type { Item } from '@/models/item';

import { storage, STORAGE_KEYS } from '@/utils/storage';

export const seedExchanges: Exchange[] = [
  {
    id: 'exchange_seed',
    from_user_id: 'user_me',
    to_user_id: 'user_lin',
    from_item_id: 'item_chair',
    to_item_id: 'item_camera',
    status: ExchangeStatus.PENDING,
    message: '露营椅换拍立得，可以同城当面交换。',
    expected_item_versions: {
      item_chair: 1,
      item_camera: 1,
    },
    version: 1,
    created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  },
];

export interface TransitionOptions {
  expectedExchangeVersion?: number;
}

const getConflictMessage = (reason: ExchangeConflictReason) => {
  const messages: Record<ExchangeConflictReason, string> = {
    [ExchangeConflictReason.ITEM_CHANGED]: '物品版本已变化，本次同意已失效',
    [ExchangeConflictReason.ITEM_OCCUPIED]: '物品已被另一笔有效交换占用',
    [ExchangeConflictReason.ITEM_UNAVAILABLE]: '有物品当前不可交换',
    [ExchangeConflictReason.EXCHANGE_CHANGED]: '交换记录版本已变化，请刷新后重试',
  };
  return messages[reason];
};

const makeConflict = (
  reason: ExchangeConflictReason,
  item?: Item,
  winnerExchangeId?: string,
): ExchangeConflictResult => ({
  reason,
  message: getConflictMessage(reason),
  item_id: item?.id,
  winner_exchange_id: winnerExchangeId,
  detected_at: new Date().toISOString(),
});

const markConflict = (
  current: Exchange,
  reason: ExchangeConflictReason,
  item?: Item,
  winnerExchangeId?: string,
): Exchange => ({
  ...current,
  status: ExchangeStatus.CONFLICTED,
  conflict_result: makeConflict(reason, item, winnerExchangeId),
  version: current.version + 1,
  updated_at: new Date().toISOString(),
});

const replaceExchange = (exchanges: Exchange[], nextExchange: Exchange) =>
  exchanges.map((item) => (item.id === nextExchange.id ? nextExchange : item));

const conflictByItemState = (
  exchange: Exchange,
  item: Item | undefined,
  expectedVersions: Record<string, number>,
): ExchangeConflictResult | null => {
  if (!item) return makeConflict(ExchangeConflictReason.ITEM_UNAVAILABLE);
  if (item.occupied_by_exchange_id && item.occupied_by_exchange_id !== exchange.id) {
    return makeConflict(
      ExchangeConflictReason.ITEM_OCCUPIED,
      item,
      item.occupied_by_exchange_id,
    );
  }
  if (item.status !== ItemStatus.AVAILABLE) {
    return makeConflict(ExchangeConflictReason.ITEM_UNAVAILABLE, item);
  }
  if (expectedVersions[item.id] !== undefined && item.version !== expectedVersions[item.id]) {
    return makeConflict(ExchangeConflictReason.ITEM_CHANGED, item);
  }
  return null;
};

export const exchangeApi = {
  async list(): Promise<Exchange[]> {
    const exchanges = await storage.get<Exchange[]>(STORAGE_KEYS.exchanges, []);
    if (exchanges.length) return exchanges;
    return storage.transaction<Exchange[]>(async (tx) => {
      const current = await tx.get<Exchange[]>(STORAGE_KEYS.exchanges, []);
      if (current.length) {
        tx.result(current);
        return;
      }
      tx.set(STORAGE_KEYS.exchanges, seedExchanges);
      tx.result(seedExchanges);
    }) as Promise<Exchange[]>;
  },

  async create(draft: ExchangeDraft): Promise<Exchange> {
    return storage.transaction<Exchange>(async (tx) => {
      const exchanges = await tx.get<Exchange[]>(STORAGE_KEYS.exchanges, []);
      const items = await tx.get<Item[]>(STORAGE_KEYS.items, []);
      const targetItem = items.find((item) => item.id === draft.to_item_id);
      const sourceItem = items.find((item) => item.id === draft.from_item_id);

      if (!targetItem || !sourceItem || targetItem.status !== ItemStatus.AVAILABLE) {
        throw new Error('目标物品当前不可交换');
      }
      if (sourceItem.status !== ItemStatus.AVAILABLE || sourceItem.occupied_by_exchange_id) {
        throw new Error('用来交换的物品已被占用');
      }

      const timestamp = new Date().toISOString();
      const nextExchange: Exchange = {
        ...draft,
        id: storage.createId('exchange'),
        status: ExchangeStatus.PENDING,
        expected_item_versions: {
          [sourceItem.id]: sourceItem.version,
          [targetItem.id]: targetItem.version,
        },
        version: 1,
        created_at: timestamp,
        updated_at: timestamp,
      };
      tx.set(STORAGE_KEYS.exchanges, [nextExchange, ...exchanges]);
      tx.result(nextExchange);
    }) as Promise<Exchange>;
  },

  async transition(
    id: string,
    status: ExchangeStatus,
    options: TransitionOptions = {},
  ): Promise<Exchange> {
    return storage.transaction<Exchange>(async (tx) => {
      const exchanges = await tx.get<Exchange[]>(STORAGE_KEYS.exchanges, []);
      const items = await tx.get<Item[]>(STORAGE_KEYS.items, []);
      const current = exchanges.find((item) => item.id === id);
      if (!current) throw new Error('交换请求不存在');
      if (
        typeof options.expectedExchangeVersion === 'number' &&
        current.version !== options.expectedExchangeVersion
      ) {
        throw new Error('交换记录已被其他窗口更新，请刷新后重试');
      }
      if (!EXCHANGE_ACTION_FLOW[current.status].includes(status)) {
        throw new Error('当前状态不允许该操作');
      }

      if (status === ExchangeStatus.ACCEPTED) {
        const fromItem = items.find((item) => item.id === current.from_item_id);
        const toItem = items.find((item) => item.id === current.to_item_id);
        const expectedItemVersions = current.expected_item_versions ?? {};
        const conflict =
          conflictByItemState(current, fromItem, expectedItemVersions) ??
          conflictByItemState(current, toItem, expectedItemVersions);

        if (conflict) {
          const conflicted = {
            ...markConflict(
              current,
              conflict.reason,
              items.find((item) => item.id === conflict.item_id),
              conflict.winner_exchange_id,
            ),
            conflict_result: conflict,
          };
          tx.set(STORAGE_KEYS.exchanges, replaceExchange(exchanges, conflicted));
          tx.result(conflicted);
          return;
        }

        const nextItems = items.map((item) =>
          item.id === current.from_item_id || item.id === current.to_item_id
            ? {
                ...item,
                status: ItemStatus.BOOKED,
                occupied_by_exchange_id: current.id,
                version: item.version + 1,
              }
            : item,
        );
        const nextExchange: Exchange = {
          ...current,
          status,
          conflict_result: undefined,
          expected_item_versions: {
            [current.from_item_id]:
              (nextItems.find((item) => item.id === current.from_item_id)?.version ?? 1),
            [current.to_item_id]:
              (nextItems.find((item) => item.id === current.to_item_id)?.version ?? 1),
          },
          version: current.version + 1,
          updated_at: new Date().toISOString(),
        };
        tx.set(STORAGE_KEYS.items, nextItems);
        tx.set(STORAGE_KEYS.exchanges, replaceExchange(exchanges, nextExchange));
        tx.result(nextExchange);
        return;
      }

      if (status === ExchangeStatus.COMPLETED) {
        const occupiedItems = [current.from_item_id, current.to_item_id].map((itemId) =>
          items.find((item) => item.id === itemId),
        );
        const badItem = occupiedItems.find(
          (item) =>
            !item ||
            item.status !== ItemStatus.BOOKED ||
            item.occupied_by_exchange_id !== current.id ||
            current.expected_item_versions?.[item.id] !== item.version,
        );

        if (badItem) {
          const conflicted = markConflict(
            current,
            ExchangeConflictReason.ITEM_CHANGED,
            badItem,
          );
          tx.set(STORAGE_KEYS.exchanges, replaceExchange(exchanges, conflicted));
          tx.result(conflicted);
          return;
        }

        const nextItems = items.map((item) =>
          item.id === current.from_item_id || item.id === current.to_item_id
            ? {
                ...item,
                status: ItemStatus.EXCHANGED,
                occupied_by_exchange_id: current.id,
                version: item.version + 1,
              }
            : item,
        );
        const nextExchange: Exchange = {
          ...current,
          status,
          expected_item_versions: {
            [current.from_item_id]:
              nextItems.find((item) => item.id === current.from_item_id)?.version ?? 1,
            [current.to_item_id]:
              nextItems.find((item) => item.id === current.to_item_id)?.version ?? 1,
          },
          version: current.version + 1,
          updated_at: new Date().toISOString(),
        };
        tx.set(STORAGE_KEYS.items, nextItems);
        tx.set(STORAGE_KEYS.exchanges, replaceExchange(exchanges, nextExchange));
        tx.result(nextExchange);
        return;
      }

      const nextExchange: Exchange = {
        ...current,
        status,
        conflict_result: status === ExchangeStatus.REJECTED ? undefined : current.conflict_result,
        version: current.version + 1,
        updated_at: new Date().toISOString(),
      };
      tx.set(STORAGE_KEYS.exchanges, replaceExchange(exchanges, nextExchange));
      tx.result(nextExchange);
    }) as Promise<Exchange>;
  },
};
