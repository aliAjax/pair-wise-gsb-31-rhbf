import { ItemCondition, ItemStatus } from '@/constants/item';
import type { Item, ItemDraft } from '@/models/item';

import { storage, STORAGE_KEYS } from '@/utils/storage';

export const seedItems: Item[] = [
  {
    id: 'item_camera',
    user_id: 'user_lin',
    title: '富士拍立得 Mini 旧机',
    description: '成色干净，附一包相纸，想换小型蓝牙音箱或桌面灯。',
    category: '数码',
    condition: ItemCondition.GOOD,
    images: [],
    status: ItemStatus.AVAILABLE,
    version: 1,
    location: '杭州 · 西湖',
    created_at: new Date().toISOString(),
  },
  {
    id: 'item_books',
    user_id: 'user_chen',
    title: '设计与产品书 6 本',
    description: '搬家清书柜，适合产品/视觉入门，接受换绿植、咖啡器具。',
    category: '书籍',
    condition: ItemCondition.LIKE_NEW,
    images: [],
    status: ItemStatus.AVAILABLE,
    version: 1,
    location: '苏州 · 工业园',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
  },
  {
    id: 'item_chair',
    user_id: 'user_me',
    title: '可折叠露营椅',
    description: '去年买的，露营两次，有轻微使用痕迹，想换收纳盒。',
    category: '运动',
    condition: ItemCondition.GOOD,
    images: [],
    status: ItemStatus.AVAILABLE,
    version: 1,
    location: '上海 · 徐汇',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
  {
    id: 'item_lamp',
    user_id: 'user_lin',
    title: '木质小夜灯',
    description: '暖光，适合床头。已完成交换，保留记录用于状态展示。',
    category: '家居',
    condition: ItemCondition.LIKE_NEW,
    images: [],
    status: ItemStatus.EXCHANGED,
    version: 1,
    location: '杭州 · 西湖',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 90).toISOString(),
  },
];

export const itemApi = {
  async list(): Promise<Item[]> {
    const items = await storage.get<Item[]>(STORAGE_KEYS.items, []);
    if (items.length) return items;
    return storage.transaction<Item[]>(async (tx) => {
      const current = await tx.get<Item[]>(STORAGE_KEYS.items, []);
      if (current.length) {
        tx.result(current);
        return;
      }
      tx.set(STORAGE_KEYS.items, seedItems);
      tx.result(seedItems);
    }) as Promise<Item[]>;
  },

  async detail(id: string): Promise<Item | undefined> {
    const items = await this.list();
    return items.find((item) => item.id === id);
  },

  async create(draft: ItemDraft): Promise<Item> {
    return storage.transaction<Item>(async (tx) => {
      const items = await tx.get<Item[]>(STORAGE_KEYS.items, []);
      const nextItem: Item = {
        ...draft,
        id: storage.createId('item'),
        status: draft.status ?? ItemStatus.AVAILABLE,
        occupied_by_exchange_id: undefined,
        version: 1,
        created_at: new Date().toISOString(),
      };
      tx.set(STORAGE_KEYS.items, [nextItem, ...items]);
      tx.result(nextItem);
    }) as Promise<Item>;
  },

  async update(id: string, patch: Partial<Item>): Promise<Item> {
    return storage.transaction<Item>(async (tx) => {
      const items = await tx.get<Item[]>(STORAGE_KEYS.items, []);
      const current = items.find((item) => item.id === id);
      if (!current) throw new Error('物品不存在');
      const nextItem: Item = {
        ...current,
        ...patch,
        version: Math.max(current.version ?? 1, patch.version ?? 0) + 1,
      };
      tx.set(
        STORAGE_KEYS.items,
        items.map((item) => (item.id === id ? nextItem : item)),
      );
      tx.result(nextItem);
    }) as Promise<Item>;
  },

  async setStatus(
    id: string,
    status: ItemStatus,
    expectedVersion?: number,
  ): Promise<Item | null> {
    return storage.transaction<Item | null>(async (tx) => {
      const items = await tx.get<Item[]>(STORAGE_KEYS.items, []);
      const current = items.find((item) => item.id === id);
      if (!current) throw new Error('物品不存在');
      if (typeof expectedVersion === 'number' && current.version !== expectedVersion) {
        tx.result(null);
        return;
      }
      if (status === ItemStatus.OFFLINE && current.occupied_by_exchange_id) {
        tx.result(null);
        return;
      }
      const nextItem: Item = {
        ...current,
        status,
        version: current.version + 1,
        occupied_by_exchange_id:
          status === ItemStatus.AVAILABLE ? undefined : current.occupied_by_exchange_id,
      };
      tx.set(
        STORAGE_KEYS.items,
        items.map((item) => (item.id === id ? nextItem : item)),
      );
      tx.result(nextItem);
    }) as Promise<Item | null>;
  },
};
