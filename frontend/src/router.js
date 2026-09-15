import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from './stores/auth';

const routes = [
  { path: '/login', name: 'login', component: () => import('./pages/LoginPage.vue'), meta: { public: true } },
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: 'dashboard', component: () => import('./pages/DashboardPage.vue'), meta: { title: '抢修态势' } },
  { path: '/faults', name: 'faults', component: () => import('./pages/FaultsPage.vue'), meta: { title: '故障报修' } },
  { path: '/tickets', name: 'tickets', component: () => import('./pages/TicketsPage.vue'), meta: { title: '抢修工单' } },
  { path: '/parts', name: 'parts', component: () => import('./pages/PartsPage.vue'), meta: { title: '备件库存' } },
  { path: '/assets', name: 'assets', component: () => import('./pages/AssetsPage.vue'), meta: { title: '配网资产' } },
  {
    path: '/audit',
    name: 'audit',
    component: () => import('./pages/AuditPage.vue'),
    meta: { title: '审计日志', roles: ['auditor'] },
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

/** 路由守卫：未登录去登录页；角色受限页面越权访问回首页 */
router.beforeEach((to) => {
  const auth = useAuthStore();
  if (to.meta.public) {
    if (auth.isLoggedIn && to.name === 'login') return { path: '/dashboard' };
    return true;
  }
  if (!auth.isLoggedIn) return { path: '/login', query: { redirect: to.fullPath } };
  if (to.meta.roles && !to.meta.roles.includes(auth.role)) return { path: '/dashboard' };
  return true;
});
