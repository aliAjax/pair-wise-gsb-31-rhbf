import { defineStore } from 'pinia';

import { exchangeApi } from '@/api/exchangeApi';
import { ExchangeStatus } from '@/constants/exchange';
import { FORM_MESSAGES } from '@/constants/messages';
import type { Exchange, ExchangeDraft } from '@/models/exchange';
import { itemApi } from '@/api/itemApi';
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
    async refreshLinkedItems() {
      const itemStore = useItemStore();
      itemStore.items = await itemApi.list();
    },
    async create(draft: ExchangeDraft) {
      try {
        const exchange = await exchangeApi.create({ ...draft, status: ExchangeStatus.PENDING });
        this.exchanges = await exchangeApi.list();
        await this.refreshLinkedItems();
        message('交换请求已发出', 'success');
        return exchange;
      } catch (error) {
        message(error instanceof Error ? error.message : '交换请求创建失败', 'error');
        return null;
      }
    },
    async accept(exchangeOrId: Exchange | string) {
      const id = typeof exchangeOrId === 'string' ? exchangeOrId : exchangeOrId.id;
      const current = this.exchanges.find((item) => item.id === id);
      if (!current) return;
      try {
        const result = await exchangeApi.transition(id, ExchangeStatus.ACCEPTED, {
          expectedExchangeVersion: current.version,
        });
        this.exchanges = await exchangeApi.list();
        await this.refreshLinkedItems();
        if (result.status === ExchangeStatus.CONFLICTED) {
          message(result.conflict_result?.message ?? FORM_MESSAGES.exchangeConflict, 'error');
        } else {
          message('已同意交换，双方物品已进入占用', 'success');
        }
      } catch (error) {
        this.exchanges = await exchangeApi.list();
        await this.refreshLinkedItems();
        message(error instanceof Error ? error.message : FORM_MESSAGES.itemVersionChanged, 'error');
      }
    },
    async reject(id: string) {
      const current = this.exchanges.find((item) => item.id === id);
      try {
        await exchangeApi.transition(id, ExchangeStatus.REJECTED, {
          expectedExchangeVersion: current?.version,
        });
        this.exchanges = await exchangeApi.list();
        message('已拒绝交换', 'success');
      } catch (error) {
        this.exchanges = await exchangeApi.list();
        message(error instanceof Error ? error.message : '交换记录已变化，请刷新后重试', 'error');
      }
    },
    async complete(exchangeOrId: Exchange | string) {
      const id = typeof exchangeOrId === 'string' ? exchangeOrId : exchangeOrId.id;
      const current = this.exchanges.find((item) => item.id === id);
      if (!current) return;
      try {
        const result = await exchangeApi.transition(id, ExchangeStatus.COMPLETED, {
          expectedExchangeVersion: current.version,
        });
        this.exchanges = await exchangeApi.list();
        await this.refreshLinkedItems();
        if (result.status === ExchangeStatus.CONFLICTED) {
          message(result.conflict_result?.message ?? FORM_MESSAGES.exchangeConflict, 'error');
        } else {
          message('交换已完成，双方物品状态已更新', 'success');
        }
      } catch (error) {
        this.exchanges = await exchangeApi.list();
        await this.refreshLinkedItems();
        message(error instanceof Error ? error.message : FORM_MESSAGES.itemVersionChanged, 'error');
      }
    },
  },
});
