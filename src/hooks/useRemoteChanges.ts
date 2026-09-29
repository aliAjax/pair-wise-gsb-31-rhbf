import { onBeforeUnmount, onMounted } from 'vue';

import { STORAGE_KEYS } from '@/utils/storage';

/**
 * 监听其他浏览器窗口对本地数据的写入。
 * 当 items / exchanges 在别处被事务改写后，本窗口立即重新拉取，
 * 避免“物主在另一处答应交换，本窗口仍按旧数据操作”。
 */
export const useRemoteChanges = (onRemoteChange: (changedKey: string) => void | Promise<void>) => {
  const WATCHED_KEYS = new Set<string>([STORAGE_KEYS.items, STORAGE_KEYS.exchanges]);

  const handler = (event: StorageEvent) => {
    if (event.key && WATCHED_KEYS.has(event.key)) {
      void onRemoteChange(event.key);
    }
  };

  onMounted(() => window.addEventListener('storage', handler));
  onBeforeUnmount(() => window.removeEventListener('storage', handler));
};
