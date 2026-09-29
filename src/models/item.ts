import { ItemCondition, ItemStatus } from '@/constants/item';

export interface Item {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  condition: ItemCondition;
  images: string[];
  status: ItemStatus;
  /** 乐观锁版本号，每次写入自增；旧记录缺失时由迁移补成 1 */
  version: number;
  /** 当前未结占用（已同意未完成）指向的交换 id，无占用时为 null */
  hold_exchange_id: string | null;
  location: string;
  created_at: string;
}

export type ItemDraft = Omit<Item, 'id' | 'status' | 'version' | 'hold_exchange_id' | 'created_at'> & {
  status?: ItemStatus;
  version?: number;
  hold_exchange_id?: string | null;
};
