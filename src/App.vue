<template>
  <van-config-provider :theme="vantTheme">
    <GlobalErrorBoundary>
      <div class="app-shell">
        <header class="topbar">
          <RouterLink class="brand" to="/home">
            <span>ReSwap</span>
            <small>物尽其用</small>
          </RouterLink>
          <nav>
            <RouterLink to="/home">首页</RouterLink>
            <RouterLink to="/publish">发布</RouterLink>
            <RouterLink to="/exchanges">交换</RouterLink>
            <RouterLink to="/profile">我的</RouterLink>
          </nav>
          <button class="theme-toggle" type="button" @click="themeStore.toggle">
            {{ themeStore.token.label }}
          </button>
        </header>
        <main>
          <RouterView />
        </main>
      </div>
    </GlobalErrorBoundary>
  </van-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted, provide } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import { ConfigProvider as VanConfigProvider } from 'vant';

import GlobalErrorBoundary from '@/components/common/GlobalErrorBoundary';
import { PAGE_MESSAGES } from '@/constants/messages';
import { useRemoteChanges } from '@/hooks/useRemoteChanges';
import { useAuthStore } from '@/stores/authStore';
import { useExchangeStore } from '@/stores/exchangeStore';
import { useItemStore } from '@/stores/itemStore';
import { useThemeStore } from '@/stores/themeStore';
import { EXCHANGES_KEY, NICKNAME_KEY } from '@/types/injection';
import { message } from '@/utils/message';
import { STORAGE_KEYS } from '@/utils/storage';
import { recoverPendingTransaction } from '@/utils/transaction';
import { toVantTheme } from '@/utils/themeUtils';

const authStore = useAuthStore();
const itemStore = useItemStore();
const exchangeStore = useExchangeStore();
const themeStore = useThemeStore();
const vantTheme = computed(() => toVantTheme(themeStore.theme));

const exchangesSnapshot = computed(() => exchangeStore.exchanges);
provide(EXCHANGES_KEY, exchangesSnapshot);
provide(NICKNAME_KEY, (userId: string) => authStore.users.find((user) => user.id === userId)?.nickname);

onMounted(async () => {
  themeStore.hydrate();

  // 写入中断后重开浏览器：committed 续完、prepared 完整退回
  const recovery = await recoverPendingTransaction();
  if (recovery.resumed) message(PAGE_MESSAGES.txnResumed, 'success');
  if (recovery.rolledBack) message(PAGE_MESSAGES.txnRolledBack, 'info');

  await Promise.all([authStore.hydrate(), itemStore.hydrate(), exchangeStore.hydrate()]);
});

// 另一窗口答应/完成后，本窗口按最新数据刷新，杜绝按旧状态二次提交
useRemoteChanges(async (changedKey) => {
  if (changedKey === STORAGE_KEYS.items) {
    await itemStore.hydrate();
  }
  if (changedKey === STORAGE_KEYS.exchanges) {
    await exchangeStore.hydrate();
  }
});
</script>
