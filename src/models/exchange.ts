import { ExchangeConflictReason, ExchangeStatus } from '@/constants/exchange';

/** 竞争失败时记录的冲突结果，挂在败方交换记录上 */
export interface ExchangeConflict {
  reason: ExchangeConflictReason;
  /** 赢得物品占用的那笔交换 id */
  winner_exchange_id: string;
  /** 发生冲突的物品 id（可能是己方或对方物品） */
  item_id: string;
  detail: string;
  conflicted_at: string;
}

export interface Exchange {
  id: string;
  from_user_id: string;
  to_user_id: string;
  from_item_id: string;
  to_item_id: string;
  status: ExchangeStatus;
  message: string;
  /** 乐观锁版本号，每次状态流转自增；旧记录缺失时由迁移补成 1 */
  version: number;
  /** 发起时双方物品的版本快照，确认前据此核对物品是否被改动 */
  item_versions: {
    from_item_version: number;
    to_item_version: number;
  };
  /** 竞争失败（物品已被另一笔有效交换占用）时的冲突结果，正常为 null */
  conflict: ExchangeConflict | null;
  created_at: string;
  updated_at: string;
}

export type ExchangeDraft = Omit<
  Exchange,
  'id' | 'status' | 'version' | 'item_versions' | 'conflict' | 'created_at' | 'updated_at'
> & {
  status?: ExchangeStatus;
  version?: number;
  item_versions?: Exchange['item_versions'];
  conflict?: ExchangeConflict | null;
};
