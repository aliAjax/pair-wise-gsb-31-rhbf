import 'vant/lib/index.css';
import './styles.css';

import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import { bootstrapLocalData } from './api/bootstrap';
import router from './router';

bootstrapLocalData().then(() => {
  createApp(App).use(createPinia()).use(router).mount('#app');
});
