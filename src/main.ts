import 'vant/lib/index.css';
import './styles.css';

import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import router from './router';
import { migrateLocalData } from './utils/migration';
import { storage } from './utils/storage';

void (async () => {
  await storage.cleanExpired();
  // 旧记录缺少版本/占用字段时先迁移，再让任何 API 读到结构一致的数据
  await migrateLocalData();
  createApp(App).use(createPinia()).use(router).mount('#app');
})();
