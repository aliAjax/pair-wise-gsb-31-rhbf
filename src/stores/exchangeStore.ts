import { defineStore } from 'pinia';

import { exchangeApi } from '@/api/exchangeApi';
import { itemApi } from '@/api/itemApi';
import { ExchangeStatus } from '@/constants/exchange';
import type { Exchange, ExchangeDraft } from '@/models/exchange';
import { message } from '@/utils/message';

import { useItemStore } from './itemStore';

export const useExchangeStore = defineStore('exchanges', {
  state: () => ({
    exchanges: [] as Exchange[],
    statusFilter: 'all' as ExchangeStatus | 'all',
    loading: false,
  }),
  getters: {
    sent: (state) => (userId: string) => state.exchanges.filter((item) => item.from_user_id === userId),
    received: (state) => (userId: string) => state.exchanges.filter((item) => item.to_user_id === userId),
    filtered: (state) => {
      if (state.statusFilter === 'all') return state.exchanges;
      return state.exchanges.filter((item) => item.status === state.statusFilter);
    },
  },
  actions: {
    async hydrate() {
      this.loading = true;
      try {
        this.exchanges = await exchangeApi.list();
      } finally {
        this.loading = false;
      }
    },
    async refreshItems() {
      const itemStore = useItemStore();
      itemStore.items = await itemApi.list();
    },
    async create(draft: ExchangeDraft) {
      const exchange = await exchangeApi.create({ ...draft, status: ExchangeStatus.PENDING });
      this.exchanges = await exchangeApi.list();
      message('交换请求已发出', 'success');
      return exchange;
    },
    async accept(id: string) {
      const result = await exchangeApi.transition(id, ExchangeStatus.ACCEPTED);
      this.exchanges = await exchangeApi.list();
      await this.refreshItems();
      if (result.status === ExchangeStatus.CONFLICTED) {
        message(result.conflict?.detail ?? '物品已被另一笔交换占用，本请求已标记冲突', 'error');
        return result;
      }
      message('已同意交换，双方物品已占用', 'success');
      return result;
    },
    async reject(id: string) {
      await exchangeApi.transition(id, ExchangeStatus.REJECTED);
      this.exchanges = await exchangeApi.list();
      await this.refreshItems();
      message('已拒绝交换，占用已释放', 'success');
    },
    async complete(id: string) {
      await exchangeApi.transition(id, ExchangeStatus.COMPLETED);
      this.exchanges = await exchangeApi.list();
      await this.refreshItems();
      message('交换已完成，双方物品状态已更新', 'success');
    },
  },
});
