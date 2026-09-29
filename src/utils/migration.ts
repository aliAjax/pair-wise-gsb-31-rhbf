import { SETTLED_EXCHANGE_STATUSES } from '@/constants/exchange';
import { ItemStatus } from '@/constants/item';
import type { Exchange, ExchangeConflict } from '@/models/exchange';
import type { Item } from '@/models/item';

import { STORAGE_KEYS, storage } from './storage';

interface MigrationWatermark {
  items: number;
  exchanges: number;
}

/** 业务集合的结构版本（与存储信封版本独立，旧数据不带版本号也能识别） */
export const DATA_STRUCTURE_VERSION = {
  items: 2,
  exchanges: 2,
} as const;

const DEFAULT_WATERMARK: MigrationWatermark = { items: 1, exchanges: 1 };

const hasOwn = (target: object, key: string) => Object.prototype.hasOwnProperty.call(target, key);

const normalizeItem = (item: Item, openHoldMap: Map<string, string | null>): Item => {
  const version = typeof item.version === 'number' && item.version > 0 ? item.version : 1;
  const holdExchangeId = hasOwn(item, 'hold_exchange_id') ? item.hold_exchange_id : openHoldMap.get(item.id) ?? null;
  return {
    ...item,
    version,
    hold_exchange_id: holdExchangeId ?? null,
    status: item.status,
  };
};

const normalizeExchange = (exchange: Exchange): Exchange => {
  const version = typeof exchange.version === 'number' && exchange.version > 0 ? exchange.version : 1;
  const fromVersion =
    typeof exchange.item_versions?.from_item_version === 'number'
      ? exchange.item_versions.from_item_version
      : 1;
  const toVersion =
    typeof exchange.item_versions?.to_item_version === 'number'
      ? exchange.item_versions.to_item_version
      : 1;
  const conflict: ExchangeConflict | null = hasOwn(exchange, 'conflict')
    ? (exchange.conflict ?? null)
    : null;
  return {
    ...exchange,
    version,
    item_versions: { from_item_version: fromVersion, to_item_version: toVersion },
    conflict,
  };
};

/**
 * 旧记录迁移：
 * 1. 缺少 version 的物品/交换补版本号 1；
 * 2. 已同意/已完成的交换按状态回填物品占用指针（accepted→booked+hold，completed→exchanged）；
 * 3. 交换记录补齐双方物品版本快照与冲突结果字段。
 * 迁移幂等，可在每次启动时执行。
 */
export const migrateLocalData = async (): Promise<{ items: Item[]; exchanges: Exchange[] }> => {
  const watermark =
    (await storage.getRaw<MigrationWatermark>(STORAGE_KEYS.migration)) ?? DEFAULT_WATERMARK;

  let exchanges = await storage.get<Exchange[]>(STORAGE_KEYS.exchanges, []);
  let items = await storage.get<Item[]>(STORAGE_KEYS.items, []);

  // 先迁移交换，物品占用回填依赖交换的最终状态
  if (watermark.exchanges < DATA_STRUCTURE_VERSION.exchanges) {
    exchanges = exchanges.map((exchange) => normalizeExchange(exchange));
    await storage.set(STORAGE_KEYS.exchanges, exchanges);
    await storage.setRaw(STORAGE_KEYS.migration, {
      ...watermark,
      exchanges: DATA_STRUCTURE_VERSION.exchanges,
    });
  }

  if (watermark.items < DATA_STRUCTURE_VERSION.items) {
    const openHoldMap = new Map<string, string | null>();
    for (const exchange of exchanges) {
      if (exchange.status === 'accepted') {
        openHoldMap.set(exchange.from_item_id, exchange.id);
        openHoldMap.set(exchange.to_item_id, exchange.id);
      }
    }
    items = items.map((item) => {
      const normalized = normalizeItem(item, openHoldMap);
      // 仅在旧状态与占用关系矛盾时纠偏，不覆盖用户的真实终态
      const holdId = openHoldMap.get(item.id);
      if (holdId && item.status !== ItemStatus.EXCHANGED) {
        return { ...normalized, status: ItemStatus.BOOKED, hold_exchange_id: holdId };
      }
      if (
        !holdId &&
        item.status === ItemStatus.BOOKED &&
        !exchanges.some(
          (entry) =>
            SETTLED_EXCHANGE_STATUSES.includes(entry.status) &&
            (entry.from_item_id === item.id || entry.to_item_id === item.id),
        )
      ) {
        return { ...normalized, status: ItemStatus.AVAILABLE, hold_exchange_id: null };
      }
      return normalized;
    });
    await storage.set(STORAGE_KEYS.items, items);
    await storage.setRaw(STORAGE_KEYS.migration, {
      ...watermark,
      exchanges: DATA_STRUCTURE_VERSION.exchanges,
      items: DATA_STRUCTURE_VERSION.items,
    });
  }

  return { items, exchanges };
};

/** 读取时兜底：即使水位丢失，也保证内存里的记录字段齐全 */
export const ensureItemShape = (item: Item): Item => normalizeItem(item, new Map());

export const ensureExchangeShape = (exchange: Exchange): Exchange => normalizeExchange(exchange);
