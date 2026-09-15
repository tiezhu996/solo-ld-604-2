import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import App from './App.vue';
import { router } from './router';
import { setUnauthorizedHandler } from './api';
import { useAuthStore } from './stores/auth';
import './styles.css';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);
app.use(ElementPlus, { locale: zhCn });

// 401 时清理会话并回登录页
setUnauthorizedHandler(() => {
  const auth = useAuthStore(pinia);
  auth.clear();
  if (router.currentRoute.value.name !== 'login') {
    router.push({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } });
  }
});

app.mount('#app');
