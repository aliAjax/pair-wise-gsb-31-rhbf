<template>
  <RouterLink class="item-card" :to="`/item/${item.id}`">
    <ItemImageGallery :images="item.images" :fallback-text="item.category" />
    <div class="item-card__body">
      <div class="item-card__topline">
        <span class="pill">{{ item.category }}</span>
        <span class="status-pill" :class="statusToneClass(item.status)">{{ formatItemStatus(item.status) }}</span>
      </div>
      <h3>{{ item.title }}</h3>
      <p>{{ item.description }}</p>
      <div v-if="occupantExchange" class="item-card__occupancy">
        <span>占用对象：{{ occupantPeer?.nickname ?? '未知用户' }} · {{ occupantOtherItem?.title ?? '未知物品' }}</span>
        <small>{{ formatExchangeStatus(occupantExchange.status) }}</small>
      </div>
      <div class="item-card__meta">
        <span>{{ item.location }}</span>
        <span>{{ formatCondition(item.condition) }}</span>
      </div>
      <div class="item-card__owner">
        <span v-if="owner">{{ owner.nickname }}</span>
        <span v-if="isMine" class="mine">我的</span>
      </div>
    </div>
  </RouterLink>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

import type { Item } from '@/models/item';
import type { User } from '@/models/user';
import { useAuthStore } from '@/stores/authStore';
import { useExchangeStore } from '@/stores/exchangeStore';
import { useItemStore } from '@/stores/itemStore';
import { useThemeStore } from '@/stores/themeStore';
import { formatCondition, formatExchangeStatus, formatItemStatus, statusToneClass } from '@/utils/formatters';

import ItemImageGallery from './ItemImageGallery.vue';

const props = defineProps<{
  item: Item;
  owner?: User;
}>();

const authStore = useAuthStore();
const exchangeStore = useExchangeStore();
const itemStore = useItemStore();
useThemeStore();
const isMine = computed(() => authStore.currentUser?.id === props.item.user_id);
const occupantExchange = computed(() =>
  props.item.occupied_by_exchange_id
    ? exchangeStore.exchanges.find((exchange) => exchange.id === props.item.occupied_by_exchange_id)
    : undefined,
);
const occupantOtherItemId = computed(() => {
  if (!occupantExchange.value) return undefined;
  return occupantExchange.value.from_item_id === props.item.id
    ? occupantExchange.value.to_item_id
    : occupantExchange.value.from_item_id;
});
const occupantOtherItem = computed(() =>
  occupantOtherItemId.value
    ? itemStore.items.find((item) => item.id === occupantOtherItemId.value)
    : undefined,
);
const occupantPeer = computed(() =>
  occupantOtherItem.value
    ? authStore.users.find((user) => user.id === occupantOtherItem.value?.user_id)
    : undefined,
);
</script>
