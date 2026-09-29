import { EXCHANGE_ACTION_FLOW, ExchangeConflictReason, ExchangeStatus } from '@/constants/exchange';
import { ItemStatus } from '@/constants/item';
import type { Exchange, ExchangeConflict, ExchangeDraft } from '@/models/exchange';
import type { Item } from '@/models/item';
import { ensureExchangeShape } from '@/utils/migration';
import {
  bumpExchange,
  bumpItem,
  checkItemOccupancy,
  isItemOpenForExchange,
} from '@/utils/occupancy';
import { STORAGE_KEYS, storage } from '@/utils/storage';
import { runTransaction, type TransactionChange } from '@/utils/transaction';

const seedExchanges: Exchange[] = [
  {
    id: 'exchange_seed',
    from_user_id: 'user_me',
    to_user_id: 'user_lin',
    from_item_id: 'item_chair',
    to_item_id: 'item_camera',
    status: ExchangeStatus.PENDING,
    message: '露营椅换拍立得，可以同城当面交换。',
    version: 1,
    item_versions: { from_item_version: 1, to_item_version: 1 },
    conflict: null,
    created_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
  },
];

const touchesItem = (exchange: Exchange, itemId: string) =>
  exchange.from_item_id === itemId || exchange.to_item_id === itemId;

/** 同意成功后，把引用了胜方任一物品、仍在等待的其他请求判为竞争失败 */
const markCompetingRequestsConflicted = (
  exchanges: Exchange[],
  winner: Exchange,
  items: Item[],
): Exchange[] => {
  return exchanges.map((exchange) => {
    if (exchange.status !== ExchangeStatus.PENDING || exchange.id === winner.id) {
      return exchange;
    }
    const conflictItemId = [winner.from_item_id, winner.to_item_id].find(
      (itemId) => itemId === exchange.from_item_id || itemId === exchange.to_item_id,
    );
    if (!conflictItemId) return exchange;
    const conflictItem = items.find((item) => item.id === conflictItemId);
    const conflict: ExchangeConflict = {
      reason: ExchangeConflictReason.ITEM_BOOKED,
      winner_exchange_id: winner.id,
      item_id: conflictItemId,
      detail: `物品「${conflictItem?.title ?? conflictItemId}」已答应给交换 ${winner.id}，本请求未能占用`,
      conflicted_at: new Date().toISOString(),
    };
    return bumpExchange(exchange, { status: ExchangeStatus.CONFLICTED, conflict });
  });
};

export const exchangeApi = {
  async list(): Promise<Exchange[]> {
    const exchanges = await storage.get<Exchange[]>(STORAGE_KEYS.exchanges, []);
    if (exchanges.length) return exchanges.map((exchange) => ensureExchangeShape(exchange));
    await storage.set(STORAGE_KEYS.exchanges, seedExchanges);
    return seedExchanges;
  },

  async create(draft: ExchangeDraft): Promise<Exchange> {
    return runTransaction('exchange:create', async ({ read }) => {
      const items = await read<Item[]>(STORAGE_KEYS.items, []);
      const exchanges = await read<Exchange[]>(STORAGE_KEYS.exchanges, []);
      const targetItem = items.find((item) => item.id === draft.to_item_id);
      const offerItem = items.find((item) => item.id === draft.from_item_id);

      if (!targetItem || !isItemOpenForExchange(targetItem, exchanges)) {
        throw new Error('目标物品当前不可交换或已被占用');
      }
      if (!offerItem || !isItemOpenForExchange(offerItem, exchanges)) {
        throw new Error('你的物品当前不可交换或已被另一笔交换占用');
      }

      const nextExchange: Exchange = {
        from_user_id: draft.from_user_id,
        to_user_id: draft.to_user_id,
        from_item_id: draft.from_item_id,
        to_item_id: draft.to_item_id,
        message: draft.message,
        id: storage.createId('exchange'),
        status: ExchangeStatus.PENDING,
        version: 1,
        item_versions: {
          from_item_version: offerItem.version,
          to_item_version: targetItem.version,
        },
        conflict: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const nextExchanges = [nextExchange, ...exchanges];
      const changes: TransactionChange<unknown>[] = [
        { key: STORAGE_KEYS.exchanges, before: exchanges, after: nextExchanges },
      ];
      return { result: nextExchange, changes };
    });
  },

  async transition(id: string, status: ExchangeStatus): Promise<Exchange> {
    return runTransaction(`exchange:${status}`, async ({ read }) => {
      const items = await read<Item[]>(STORAGE_KEYS.items, []);
      const exchanges = await read<Exchange[]>(STORAGE_KEYS.exchanges, []);
      const current = exchanges.find((item) => item.id === id);
      if (!current) throw new Error('交换请求不存在');
      if (!EXCHANGE_ACTION_FLOW[current.status].includes(status)) {
        throw new Error('当前状态不允许该操作，列表可能已在其他窗口更新');
      }

      const changes: TransactionChange<unknown>[] = [];

      // 拒绝：若此前已同意，需要把占用释放回“可交换”
      if (status === ExchangeStatus.REJECTED) {
        const nextExchange = bumpExchange(current, { status, conflict: current.conflict });
        let nextItems = items;
        if (current.status === ExchangeStatus.ACCEPTED) {
          nextItems = items.map((item) => {
            if (!touchesItem(current, item.id) || item.hold_exchange_id !== current.id) return item;
            return bumpItem(item, { status: ItemStatus.AVAILABLE, hold_exchange_id: null });
          });
        }
        changes.push({
          key: STORAGE_KEYS.exchanges,
          before: exchanges,
          after: exchanges.map((item) => (item.id === id ? nextExchange : item)),
        });
        if (nextItems !== items) {
          changes.push({ key: STORAGE_KEYS.items, before: items, after: nextItems });
        }
        return { result: nextExchange, changes };
      }

      // 同意：核对双方物品版本与未结占用
      if (status === ExchangeStatus.ACCEPTED) {
        const offerItem = items.find((item) => item.id === current.from_item_id);
        const targetItem = items.find((item) => item.id === current.to_item_id);
        if (!offerItem || !targetItem) {
          throw new Error('交换关联的物品已不存在');
        }

        const offerCheck = checkItemOccupancy(
          offerItem,
          current.item_versions.from_item_version,
          exchanges,
          current.id,
        );
        const targetCheck = checkItemOccupancy(
          targetItem,
          current.item_versions.to_item_version,
          exchanges,
          current.id,
        );
        const failed = offerCheck.blocked ? offerCheck : targetCheck.blocked ? targetCheck : null;

        if (failed) {
          // 竞争失败：本笔作废并保留冲突结果，不触碰任何物品
          const conflicted = bumpExchange(current, {
            status: ExchangeStatus.CONFLICTED,
            conflict: failed.conflict,
          });
          changes.push({
            key: STORAGE_KEYS.exchanges,
            before: exchanges,
            after: exchanges.map((item) => (item.id === id ? conflicted : item)),
          });
          return { result: conflicted, changes };
        }

        // 占用成功：一笔交换独占两件物品
        const accepted = bumpExchange(current, { status, conflict: null });
        const nextItems = items.map((item) => {
          if (!touchesItem(current, item.id)) return item;
          return bumpItem(item, { status: ItemStatus.BOOKED, hold_exchange_id: accepted.id });
        });
        const loserExchanges = markCompetingRequestsConflicted(
          exchanges.map((item) => (item.id === id ? accepted : item)),
          accepted,
          nextItems,
        );
        changes.push({ key: STORAGE_KEYS.items, before: items, after: nextItems });
        changes.push({
          key: STORAGE_KEYS.exchanges,
          before: exchanges,
          after: loserExchanges,
        });
        return { result: accepted, changes };
      }

      // 完成：双方物品归到这笔交换，状态落为已交换
      if (status === ExchangeStatus.COMPLETED) {
        const nextExchange = bumpExchange(current, { status, conflict: null });
        const nextItems = items.map((item) => {
          if (!touchesItem(current, item.id)) return item;
          if (item.hold_exchange_id && item.hold_exchange_id !== current.id) {
            throw new Error('物品被其他有效交换占用，无法完成');
          }
          return bumpItem(item, { status: ItemStatus.EXCHANGED, hold_exchange_id: current.id });
        });
        changes.push({ key: STORAGE_KEYS.items, before: items, after: nextItems });
        changes.push({
          key: STORAGE_KEYS.exchanges,
          before: exchanges,
          after: exchanges.map((item) => (item.id === id ? nextExchange : item)),
        });
        return { result: nextExchange, changes };
      }

      throw new Error('不支持的交换操作');
    });
  },
};
