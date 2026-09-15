<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <div class="logo">⚡ 电力配网抢修闭环系统</div>
      <div class="slogan">故障报修 · 智能派工 · 备件联动 · 全程可溯</div>
      <el-form @submit.prevent="onLogin">
        <el-form-item>
          <el-input v-model="username" placeholder="用户名" size="large" :prefix-icon="User" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="password" type="password" placeholder="密码" size="large" show-password
            :prefix-icon="Lock" @keyup.enter="onLogin" />
        </el-form-item>
        <el-button type="primary" size="large" class="login-btn" :loading="loading" @click="onLogin">
          登 录
        </el-button>
      </el-form>
      <el-divider content-position="center">演示账号（密码均为 123456）</el-divider>
      <div class="quick">
        <el-tag v-for="a in demoAccounts" :key="a.u" class="quick-tag" :type="a.type" effect="plain"
          @click="fill(a.u)">
          {{ a.label }} {{ a.u }}
        </el-tag>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage } from 'element-plus';
import { User, Lock } from '@element-plus/icons-vue';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

const username = ref('dispatcher01');
const password = ref('123456');
const loading = ref(false);

const demoAccounts = [
  { u: 'dispatcher01', label: '调度员', type: 'primary' },
  { u: 'leader01', label: '班组长', type: 'success' },
  { u: 'keeper01', label: '仓管员', type: 'warning' },
  { u: 'auditor01', label: '审计员', type: 'info' },
];

function fill(u) {
  username.value = u;
  password.value = '123456';
}

async function onLogin() {
  if (!username.value || !password.value) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    await auth.login(username.value.trim(), password.value);
    ElMessage.success(`欢迎，${auth.user.name}`);
    router.push(route.query.redirect || '/dashboard');
  } catch (err) {
    ElMessage.error(err.message);
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-wrap {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #0a2540 0%, #14467c 60%, #1c5d9e 100%);
}
.login-card { width: 400px; border-radius: 12px; }
.logo { font-size: 20px; font-weight: 700; text-align: center; color: #0a2540; }
.slogan { text-align: center; color: #909399; font-size: 12px; margin: 8px 0 22px; }
.login-btn { width: 100%; }
.quick { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.quick-tag { cursor: pointer; }
</style>
