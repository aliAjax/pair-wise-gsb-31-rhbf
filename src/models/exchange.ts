import { ExchangeConflictReason, ExchangeStatus } from '@/constants/exchange';

export interface ExchangeConflictResult {
  reason: ExchangeConflictReason;
  message: string;
  item_id?: string;
  winner_exchange_id?: string;
  detected_at: string;
}

export interface Exchange {
  id: string;
  from_user_id: string;
  to_user_id: string;
  from_item_id: string;
  to_item_id: string;
  status: ExchangeStatus;
  message: string;
  expected_item_versions?: Record<string, number>;
  conflict_result?: ExchangeConflictResult;
  version: number;
  created_at: string;
  updated_at: string;
}

export type ExchangeDraft = Omit<Exchange, 'id' | 'status' | 'version' | 'created_at' | 'updated_at'> & {
  status?: ExchangeStatus;
  version?: number;
};
