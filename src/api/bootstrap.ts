import { seedExchanges } from '@/api/exchangeApi';
import { seedItems } from '@/api/itemApi';
import { seedUsers } from '@/api/userApi';
import { ExchangeConflictReason, ExchangeStatus } from '@/constants/exchange';
import { ItemStatus } from '@/constants/item';
import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import { storage, STORAGE_KEYS } from '@/utils/storage';

const getItemVersion = (item: Item | undefined) => (typeof item?.version === 'number' ? item.version : 1);

const normalizeExchanges = (items: Item[], exchanges: Exchange[]) => {
  const winners = new Map<string, { id: string; status: ExchangeStatus }>();
  const setWinner = (itemId: string, exchange: Exchange) => {
    const currentWinner = winners.get(itemId);
    if (
      !currentWinner ||
      (exchange.status === ExchangeStatus.COMPLETED &&
        currentWinner.status !== ExchangeStatus.COMPLETED)
    ) {
      winners.set(itemId, { id: exchange.id, status: exchange.status });
    }
  };

  exchanges.forEach((exchange) => {
    if (
      exchange.status === ExchangeStatus.ACCEPTED ||
      exchange.status === ExchangeStatus.COMPLETED
    ) {
      setWinner(exchange.from_item_id, exchange);
      setWinner(exchange.to_item_id, exchange);
    }
  });

  return exchanges.map((exchange) => {
    const hasVersion = typeof exchange.version === 'number';
    const expectedItemVersions = { ...(exchange.expected_item_versions ?? {}) };
    const next: Exchange = {
      ...exchange,
      version: hasVersion ? exchange.version : 1,
      expected_item_versions: expectedItemVersions,
    };
    const fromItem = items.find((item) => item.id === exchange.from_item_id);
    const toItem = items.find((item) => item.id === exchange.to_item_id);

    if (!hasVersion) {
      if (fromItem) expectedItemVersions[fromItem.id] = getItemVersion(fromItem);
      if (toItem) expectedItemVersions[toItem.id] = getItemVersion(toItem);
    }

    if (
      !hasVersion &&
      (next.status === ExchangeStatus.ACCEPTED || next.status === ExchangeStatus.COMPLETED)
    ) {
      const blockedItem = [fromItem, toItem].find(
        (item) => item && winners.get(item.id)?.id && winners.get(item.id)?.id !== exchange.id,
      );
      if (blockedItem) {
        next.status = ExchangeStatus.CONFLICTED;
        next.conflict_result = {
          reason: ExchangeConflictReason.ITEM_OCCUPIED,
          message: '迁移时发现该旧记录的物品已归属于另一笔有效交换',
          item_id: blockedItem.id,
          winner_exchange_id: winners.get(blockedItem.id)?.id,
          detected_at: new Date().toISOString(),
        };
      }
    }

    return next;
  });
};

const normalizeItems = (items: Item[], exchanges: Exchange[]) => {
  const activeById = new Map<string, Exchange>();

  exchanges.forEach((exchange) => {
    const setActive = (itemId: string) => {
      const current = activeById.get(itemId);
      if (
        !current ||
        (exchange.status === ExchangeStatus.COMPLETED &&
          current.status !== ExchangeStatus.COMPLETED)
      ) {
        activeById.set(itemId, exchange);
      }
    };
    if (
      exchange.status === ExchangeStatus.ACCEPTED ||
      exchange.status === ExchangeStatus.COMPLETED
    ) {
      setActive(exchange.from_item_id);
      setActive(exchange.to_item_id);
    }
  });

  return items.map((item) => {
    const active = activeById.get(item.id);
    const next: Item = {
      ...item,
      version: getItemVersion(item),
      occupied_by_exchange_id: item.occupied_by_exchange_id ?? active?.id,
    };

    if (active?.status === ExchangeStatus.COMPLETED) {
      next.status = ItemStatus.EXCHANGED;
      next.occupied_by_exchange_id = active.id;
    } else if (active?.status === ExchangeStatus.ACCEPTED) {
      next.status = ItemStatus.BOOKED;
      next.occupied_by_exchange_id = active.id;
    }

    return next;
  });
};

export const bootstrapLocalData = async () => {
  await storage.recoverPendingTransactions();

  await storage.transaction(async (tx) => {
    const users = await tx.get(STORAGE_KEYS.users, [] as typeof seedUsers);
    if (!users.length) tx.set(STORAGE_KEYS.users, seedUsers);
    const currentUserId = await tx.get(STORAGE_KEYS.currentUserId, '');
    if (!currentUserId) tx.set(STORAGE_KEYS.currentUserId, seedUsers[0].id);

    const legacyItems = await tx.get<Item[]>(STORAGE_KEYS.items, []);
    const legacyExchanges = await tx.get<Exchange[]>(STORAGE_KEYS.exchanges, []);
    const seededItems = legacyItems.length ? legacyItems : seedItems;
    const seededExchanges = legacyExchanges.length ? legacyExchanges : seedExchanges;

    const migratedExchanges = normalizeExchanges(seededItems, seededExchanges);
    const migratedItems = normalizeItems(seededItems, migratedExchanges);

    tx.set(STORAGE_KEYS.items, migratedItems);
    tx.set(STORAGE_KEYS.exchanges, migratedExchanges);
  });

  await storage.cleanExpired();
};
