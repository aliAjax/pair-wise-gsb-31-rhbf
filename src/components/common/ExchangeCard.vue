<template>
  <article class="exchange-card" :class="{ 'exchange-card--conflict': isConflicted }">
    <header>
      <span class="status-pill" :class="statusToneClass(exchange.status)">
        {{ formatExchangeStatus(exchange.status) }}
      </span>
      <small>{{ formatDate(exchange.updated_at) }}</small>
    </header>
    <div class="exchange-card__items">
      <div :class="{ 'is-held': !!fromItem?.hold_exchange_id }">
        <span>拿出</span>
        <strong>{{ fromItem?.title ?? '未知物品' }}</strong>
        <em v-if="fromItem && fromItem.hold_exchange_id" class="hold-tag">
          占用对象：{{ holdText(fromItem) }}
        </em>
      </div>
      <div :class="{ 'is-held': !!toItem?.hold_exchange_id }">
        <span>换取</span>
        <strong>{{ toItem?.title ?? '未知物品' }}</strong>
        <em v-if="toItem && toItem.hold_exchange_id" class="hold-tag">
          占用对象：{{ holdText(toItem) }}
        </em>
      </div>
    </div>
    <p>{{ exchange.message || formatStatusMessage(exchange.status) }}</p>

    <div v-if="isConflicted && exchange.conflict" class="conflict-box">
      <strong>冲突结果</strong>
      <span>{{ formatConflictReason(exchange.conflict.reason) }}</span>
      <p>{{ exchange.conflict.detail }}</p>
      <small>
        有效交换：{{ winnerExchange?.id }}（{{ winnerNicknames }}）·
        {{ formatDate(exchange.conflict.conflicted_at) }}
      </small>
    </div>
    <p v-else-if="isAccepted" class="hold-line">
      双方物品已被本笔交换独占，物品版本 v{{ exchange.version }}
    </p>

    <footer>
      <span v-if="fromUser && toUser">{{ fromUser.nickname }} → {{ toUser.nickname }}</span>
      <div v-if="canOperate" class="exchange-card__actions">
        <button v-if="exchange.status === ExchangeStatus.PENDING" type="button" @click="$emit('accept', exchange.id)">
          同意
        </button>
        <button v-if="exchange.status === ExchangeStatus.PENDING" type="button" @click="$emit('reject', exchange.id)">
          拒绝
        </button>
        <button
          v-if="exchange.status === ExchangeStatus.ACCEPTED && authStore.currentUser?.id === exchange.to_user_id"
          type="button"
          @click="$emit('reject', exchange.id)"
        >
          撤销同意
        </button>
        <button v-if="exchange.status === ExchangeStatus.ACCEPTED" type="button" @click="$emit('complete', exchange.id)">
          完成
        </button>
      </div>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { ExchangeStatus } from '@/constants/exchange';
import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import type { User } from '@/models/user';
import { useAuthStore } from '@/stores/authStore';
import {
  formatConflictReason,
  formatDate,
  formatExchangeStatus,
  formatHoldTarget,
  formatStatusMessage,
  statusToneClass,
} from '@/utils/formatters';

const props = defineProps<{
  exchange: Exchange;
  items: Item[];
  users: User[];
  exchanges: Exchange[];
}>();

defineEmits<{
  accept: [id: string];
  reject: [id: string];
  complete: [id: string];
}>();

const authStore = useAuthStore();
const fromItem = computed(() => props.items.find((item) => item.id === props.exchange.from_item_id));
const toItem = computed(() => props.items.find((item) => item.id === props.exchange.to_item_id));
const fromUser = computed(() => props.users.find((user) => user.id === props.exchange.from_user_id));
const toUser = computed(() => props.users.find((user) => user.id === props.exchange.to_user_id));
const isConflicted = computed(() => props.exchange.status === ExchangeStatus.CONFLICTED);
const isAccepted = computed(() => props.exchange.status === ExchangeStatus.ACCEPTED);

const winnerExchange = computed(() =>
  props.exchange.conflict
    ? props.exchanges.find((entry) => entry.id === props.exchange.conflict?.winner_exchange_id)
    : undefined,
);
const winnerNicknames = computed(() => {
  if (!winnerExchange.value) return '已不存在';
  const from = props.users.find((user) => user.id === winnerExchange.value?.from_user_id)?.nickname ?? '未知';
  const to = props.users.find((user) => user.id === winnerExchange.value?.to_user_id)?.nickname ?? '未知';
  return `${from} ↔ ${to}`;
});

const nicknameOf = (userId: string) => props.users.find((user) => user.id === userId)?.nickname;
const holdText = (item: Item) => formatHoldTarget(item, props.exchanges, nicknameOf);

const canOperate = computed(
  () =>
    authStore.currentUser?.id === props.exchange.to_user_id ||
    (authStore.currentUser?.id === props.exchange.from_user_id && props.exchange.status === ExchangeStatus.ACCEPTED),
);
</script>
