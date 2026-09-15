<template>
  <router-view v-if="isLoginPage" />
  <el-container v-else class="layout">
    <el-aside width="220px" class="aside">
      <div class="brand">
        <span class="brand-icon">⚡</span>
        <div>
          <div class="brand-name">配网抢修闭环</div>
          <div class="brand-sub">grid-repair</div>
        </div>
      </div>
      <el-menu :default-active="$route.path" router class="menu" background-color="#001529" text-color="#a6adb4"
        active-text-color="#ffffff">
        <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.title }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="crumb">{{ $route.meta.title || '' }}</div>
        <div class="user-box">
          <el-tag size="small" effect="dark" :type="roleTagType">{{ roleText }}</el-tag>
          <span class="user-name">
            {{ auth.user?.name }}
            <span v-if="auth.user?.crewName" class="muted">（{{ auth.user.crewName }}）</span>
          </span>
          <el-button size="small" text type="danger" @click="onLogout">退出登录</el-button>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessageBox } from 'element-plus';
import {
  Odometer, Warning, Tickets, Box, OfficeBuilding, Document,
} from '@element-plus/icons-vue';
import { useAuthStore } from './stores/auth';
import { RoleText } from './constants';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const isLoginPage = computed(() => route.name === 'login');
const roleText = computed(() => RoleText[auth.role] || auth.role);
const roleTagType = computed(() => ({
  dispatcher: 'primary', leader: 'success', keeper: 'warning', auditor: 'info',
}[auth.role] || 'info'));

const allMenus = [
  { path: '/dashboard', title: '抢修态势', icon: Odometer },
  { path: '/faults', title: '故障报修', icon: Warning },
  { path: '/tickets', title: '抢修工单', icon: Tickets },
  { path: '/parts', title: '备件库存', icon: Box },
  { path: '/assets', title: '配网资产', icon: OfficeBuilding },
  { path: '/audit', title: '审计日志', icon: Document, roles: ['auditor'] },
];
const menus = computed(() => allMenus.filter((m) => !m.roles || m.roles.includes(auth.role)));

async function onLogout() {
  try {
    await ElMessageBox.confirm('确认退出登录？', '提示', { type: 'warning' });
  } catch {
    return; // 用户取消
  }
  await auth.logout();
  router.push('/login');
}
</script>

<style scoped>
.layout { height: 100vh; }
.aside { background: #001529; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 10px; padding: 18px 16px; color: #fff; }
.brand-icon { font-size: 26px; }
.brand-name { font-weight: 700; font-size: 15px; }
.brand-sub { font-size: 11px; color: #6b7684; }
.menu { border-right: none; flex: 1; }
.header {
  background: #fff; display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid #e4e7ed;
}
.crumb { font-weight: 600; color: #303133; }
.user-box { display: flex; align-items: center; gap: 10px; }
.user-name { font-size: 14px; color: #606266; }
.main { padding: 20px; overflow-y: auto; }
</style>
