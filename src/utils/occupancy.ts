import {
  ExchangeConflictReason,
  OPEN_EXCHANGE_STATUSES,
  SETTLED_EXCHANGE_STATUSES,
} from '@/constants/exchange';
import { ItemStatus } from '@/constants/item';
import type { Exchange, ExchangeConflict } from '@/models/exchange';
import type { Item } from '@/models/item';

export interface OccupancyCheck {
  blocked: boolean;
  conflict: ExchangeConflict | null;
}

/** 占用这件物品的有效交换（已同意未完成），可排除某笔交换自身 */
export const findOpenHoldForItem = (
  exchanges: Exchange[],
  itemId: string,
  excludeExchangeId?: string,
): Exchange | undefined =>
  exchanges.find(
    (exchange) =>
      exchange.id !== excludeExchangeId &&
      OPEN_EXCHANGE_STATUSES.includes(exchange.status) &&
      (exchange.from_item_id === itemId || exchange.to_item_id === itemId),
  );

/** 已经把物品锁走的交换（已同意或已完成） */
export const findSettledExchangeForItem = (
  exchanges: Exchange[],
  itemId: string,
  excludeExchangeId?: string,
): Exchange | undefined =>
  exchanges.find(
    (exchange) =>
      exchange.id !== excludeExchangeId &&
      SETTLED_EXCHANGE_STATUSES.includes(exchange.status) &&
      (exchange.from_item_id === itemId || exchange.to_item_id === itemId),
  );

const buildConflict = (
  reason: ExchangeConflictReason,
  winnerExchangeId: string,
  item: Item,
  detail: string,
): ExchangeConflict => ({
  reason,
  winner_exchange_id: winnerExchangeId,
  item_id: item.id,
  detail,
  conflicted_at: new Date().toISOString(),
});

/**
 * 确认前核对：未结占用 → 物品状态 → 版本快照。
 * 返回 blocked + 冲突结果；不通过时调用方应把本笔交换置为冲突作废。
 * 顺序刻意把“已被别人占用/已交换/已下架”排在版本之前，给出更准确的冲突原因。
 */
export const checkItemOccupancy = (
  item: Item,
  expectedVersion: number,
  exchanges: Exchange[],
  selfExchangeId: string,
): OccupancyCheck => {
  const openHold = findOpenHoldForItem(exchanges, item.id, selfExchangeId);
  if (openHold) {
    return {
      blocked: true,
      conflict: buildConflict(
        ExchangeConflictReason.OPEN_HOLD,
        openHold.id,
        item,
        `物品「${item.title}」已被交换 ${openHold.id} 占用，一件物品只能归到一笔有效交换`,
      ),
    };
  }

  if (item.status === ItemStatus.EXCHANGED) {
    const settled = findSettledExchangeForItem(exchanges, item.id, selfExchangeId);
    return {
      blocked: true,
      conflict: buildConflict(
        ExchangeConflictReason.ITEM_EXCHANGED,
        settled?.id ?? selfExchangeId,
        item,
        `物品「${item.title}」已完成交换，无法再次答应`,
      ),
    };
  }

  if (item.status === ItemStatus.OFFLINE) {
    return {
      blocked: true,
      conflict: buildConflict(
        ExchangeConflictReason.ITEM_OFFLINE,
        selfExchangeId,
        item,
        `物品「${item.title}」已被物主下架，无法交换`,
      ),
    };
  }

  if (item.status === ItemStatus.BOOKED) {
    const settled = findSettledExchangeForItem(exchanges, item.id, selfExchangeId);
    return {
      blocked: true,
      conflict: buildConflict(
        ExchangeConflictReason.ITEM_BOOKED,
        settled?.id ?? selfExchangeId,
        item,
        `物品「${item.title}」已被另一笔交换预约占用`,
      ),
    };
  }

  if (item.version !== expectedVersion) {
    const settled = findSettledExchangeForItem(exchanges, item.id, selfExchangeId);
    return {
      blocked: true,
      conflict: buildConflict(
        ExchangeConflictReason.VERSION_MISMATCH,
        settled?.id ?? selfExchangeId,
        item,
        `物品「${item.title}」版本已从 ${expectedVersion} 变为 ${item.version}，确认依据已过期`,
      ),
    };
  }

  return { blocked: false, conflict: null };
};

/** 物品是否还能被新的交换请求引用（可交换且无未结占用） */
export const isItemOpenForExchange = (item: Item | undefined, exchanges: Exchange[]): boolean => {
  if (!item || item.status !== ItemStatus.AVAILABLE) return false;
  return !findOpenHoldForItem(exchanges, item.id);
};

export const bumpItem = (item: Item, patch: Partial<Item>): Item => ({
  ...item,
  ...patch,
  version: item.version + 1,
});

export const bumpExchange = (exchange: Exchange, patch: Partial<Exchange>): Exchange => ({
  ...exchange,
  ...patch,
  version: exchange.version + 1,
  updated_at: new Date().toISOString(),
});
