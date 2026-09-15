import { defineStore } from 'pinia';
import { api } from '../api';

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('grid_token') || '',
    user: JSON.parse(localStorage.getItem('grid_user') || 'null'),
  }),
  getters: {
    isLoggedIn: (s) => !!s.token && !!s.user,
    role: (s) => (s.user ? s.user.role : ''),
    isDispatcher: (s) => !!s.user && s.user.role === 'dispatcher',
    isLeader: (s) => !!s.user && s.user.role === 'leader',
    isKeeper: (s) => !!s.user && s.user.role === 'keeper',
    isAuditor: (s) => !!s.user && s.user.role === 'auditor',
  },
  actions: {
    async login(username, password) {
      const data = await api('POST', '/auth/login', { username, password });
      this.token = data.token;
      this.user = data.user;
      localStorage.setItem('grid_token', data.token);
      localStorage.setItem('grid_user', JSON.stringify(data.user));
    },
    async logout() {
      try {
        await api('POST', '/auth/logout');
      } catch { /* 忽略登出异常 */ }
      this.clear();
    },
    clear() {
      this.token = '';
      this.user = null;
      localStorage.removeItem('grid_token');
      localStorage.removeItem('grid_user');
    },
  },
});
