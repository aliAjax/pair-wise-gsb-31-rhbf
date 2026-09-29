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

export type TransactionPhase = 'prepared' | 'committed';

export interface TransactionWrite {
  key: string;
  payload: unknown;
  ttl?: number;
}

export interface TransactionSnapshot {
  key: string;
  payload: unknown;
  existed: boolean;
  ttl?: number;
}

export interface TransactionJournal {
  id: string;
  phase: TransactionPhase;
  writes: TransactionWrite[];
  snapshots: TransactionSnapshot[];
  createdAt: string;
  committedAt?: string;
}

export interface LocalTransaction<T> {
  get<Data>(key: string, fallback: Data): Promise<Data>;
  set<Data>(key: string, payload: Data, ttl?: number): void;
  conflict(): never;
  result(value: T): void;
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
