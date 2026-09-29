import type { ExchangeStatus } from '@/constants/exchange';
import type { ItemCondition, ItemStatus } from '@/constants/item';

export interface Option<T extends string> {
  label: string;
  value: T;
}

export interface PersistedEnvelope<T> {
  version: number;
  expiresAt?: number;
  payload: T;
}

export interface StatusFilter {
  item?: ItemStatus;
  exchange?: ExchangeStatus;
  condition?: ItemCondition;
}

export interface ImageFilePayload {
  id: string;
  name: string;
  dataUrl: string;
}

/** 一次本机事务所要改写的存储键（items / exchanges 等） */
export type TransactionKey = 'reswap:items' | 'reswap:exchanges';

export type TransactionState = 'prepared' | 'committed';

/**
 * 可恢复的本机事务日志（write-ahead log）。
 * prepare：先把“改前快照 + 改后结果”整体落盘；
 * commit：写入新数据后把状态翻成 committed；
 * 重开浏览器时：committed 则续完（确保新数据落盘），prepared 则用快照完整退回。
 */
export interface TransactionLog {
  id: string;
  action: string;
  state: TransactionState;
  preparedAt: string;
  committedAt: string | null;
  changes: Array<{
    key: TransactionKey;
    before: unknown;
    after: unknown;
  }>;
}
