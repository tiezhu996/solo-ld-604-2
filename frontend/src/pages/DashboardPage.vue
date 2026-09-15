<template>
  <div>
    <div class="page-header">
      <div>
        <h2>抢修态势</h2>
        <div class="sub">实时掌握故障处置进度与班组运力</div>
      </div>
      <el-button :icon="Refresh" circle :loading="loading" @click="load" />
    </div>

    <div class="stat-row">
      <StatCard title="待派工工单" :value="data.waitDispatch" color="#e6a23c" hint="等待调度派工" />
      <StatCard title="在途抢修" :value="data.active" color="#f56c6c" hint="已派工 / 到场 / 处理中" />
      <StatCard title="已复电待关闭" :value="data.restored" color="#67c23a" hint="等待班组长闭环" />
      <StatCard title="平均复电时长" :value="data.avgRestoreMinutes" suffix=" 分钟" color="#409eff"
        hint="登记到复电均值" />
      <StatCard title="未闭环报修" :value="data.openReports" color="#909399" hint="含已合并报修" />
    </div>

    <el-row :gutter="16">
      <el-col :span="14">
        <el-card shadow="never">
          <template #header>
            <div class="card-head">
              <span>班组状态</span>
              <el-switch v-if="auth.isDispatcher" v-model="dutyEdit" active-text="值班维护" />
            </div>
          </template>
          <div class="card-grid">
            <div v-for="c in data.crews" :key="c.id" class="crew-wrap">
              <CrewCard :crew="c" />
              <div v-if="auth.isDispatcher && dutyEdit" class="duty-bar">
                <el-button size="small" :type="c.duty_status === 'ON' ? 'info' : 'success'" plain
                  @click="toggleDuty(c)">
                  {{ c.duty_status === 'ON' ? '转为休息' : '转为值班' }}
                </el-button>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card shadow="never" class="mb16">
          <template #header>未闭环故障类型分布</template>
          <EmptyState v-if="!data.typeBreakdown?.length" text="当前没有未闭环故障" />
          <div v-for="t in data.typeBreakdown" :key="t.type" class="type-row">
            <span class="type-name">{{ FaultTypeText[t.type] || t.type }}</span>
            <el-progress :percentage="typePercent(t.count)" :stroke-width="14" :text-inside="true"
              :format="() => `${t.count} 单`" :color="typeColor" />
          </div>
        </el-card>
        <el-card shadow="never">
          <template #header>最新工单</template>
          <el-table :data="data.recentTickets" size="small" :show-header="false">
            <el-table-column width="90">
              <template #default="{ row }"><span class="mono">{{ row.ticket_no }}</span></template>
            </el-table-column>
            <el-table-column>
              <template #default="{ row }">
                {{ FaultTypeText[row.fault_type] }} · {{ row.feeder_line }}
                <span v-if="row.crew_name" class="muted">（{{ row.crew_name }}）</span>
              </template>
            </el-table-column>
            <el-table-column width="80">
              <template #default="{ row }"><PriorityTag :value="row.priority" /></template>
            </el-table-column>
            <el-table-column width="90">
              <template #default="{ row }"><StatusBadge kind="ticket" :value="row.status" /></template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api, runAction } from '../api';
import { useAuthStore } from '../stores/auth';
import { FaultTypeText } from '../constants';
import StatCard from '../components/StatCard.vue';
import CrewCard from '../components/CrewCard.vue';
import StatusBadge from '../components/StatusBadge.vue';
import PriorityTag from '../components/PriorityTag.vue';
import EmptyState from '../components/EmptyState.vue';

const auth = useAuthStore();
const loading = ref(false);
const dutyEdit = ref(false);
const data = ref({ crews: [], typeBreakdown: [], recentTickets: [] });

async function load() {
  loading.value = true;
  try {
    data.value = await api('GET', '/dashboard');
  } catch (err) {
    ElMessage.error(err.message);
  } finally {
    loading.value = false;
  }
}

function typePercent(count) {
  const max = Math.max(...data.value.typeBreakdown.map((t) => t.count), 1);
  return Math.round((count / max) * 100);
}
const typeColor = () => '#f56c6c';

async function toggleDuty(crew) {
  const target = crew.duty_status === 'ON' ? 'OFF' : 'ON';
  await runAction(
    () => api('PATCH', `/crews/${crew.id}/duty`, { duty_status: target }),
    `班组「${crew.name}」已${target === 'ON' ? '转为值班' : '转为休息'}`,
  );
  await load();
}

let timer;
onMounted(() => {
  load();
  timer = setInterval(load, 15000);
});
onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.card-head { display: flex; justify-content: space-between; align-items: center; }
.mb16 { margin-bottom: 16px; }
.type-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.type-name { width: 70px; font-size: 13px; color: #606266; flex-shrink: 0; }
.type-row .el-progress { flex: 1; }
.mono { font-family: monospace; color: #409eff; }
.crew-wrap { position: relative; }
.duty-bar { margin-top: 6px; text-align: right; }
</style>
