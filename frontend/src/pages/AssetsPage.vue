<template>
  <div>
    <div class="page-header">
      <div>
        <h2>配网资产</h2>
        <div class="sub">资产台账、健康状态与历史故障</div>
      </div>
      <el-button :icon="Refresh" circle :loading="loading" @click="load" />
    </div>

    <el-card shadow="never">
      <div class="filter-bar">
        <el-select v-model="feederLine" placeholder="全部馈线" clearable style="width: 170px" @change="load">
          <el-option v-for="l in feederLines" :key="l" :label="l" :value="l" />
        </el-select>
      </div>
      <el-table :data="assets" v-loading="loading" stripe @row-click="openHistory" row-class-name="clickable">
        <el-table-column prop="asset_code" label="资产编码" width="110">
          <template #default="{ row }"><span class="mono">{{ row.asset_code }}</span></template>
        </el-table-column>
        <el-table-column prop="asset_type" label="类型" width="110" />
        <el-table-column prop="feeder_line" label="所属馈线" width="130" />
        <el-table-column prop="voltage_level" label="电压等级" width="90" />
        <el-table-column prop="location_desc" label="安装位置" min-width="180" show-overflow-tooltip />
        <el-table-column label="健康状态" width="140">
          <template #default="{ row }">
            <el-dropdown v-if="auth.isDispatcher" trigger="click" @command="(s) => setHealth(row, s)">
              <span class="health-edit" @click.stop>
                <StatusBadge kind="health" :value="row.health_status" />
                <el-icon class="edit-icon"><Edit /></el-icon>
              </span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="s in AssetHealthStatus" :key="s" :command="s">
                    {{ AssetHealthStatusText[s] }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <StatusBadge v-else kind="health" :value="row.health_status" />
          </template>
        </el-table-column>
        <el-table-column prop="owner_crew_name" label="归属班组" width="100">
          <template #default="{ row }">{{ row.owner_crew_name || '—' }}</template>
        </el-table-column>
        <el-table-column label="未闭环工单" width="100" align="center">
          <template #default="{ row }">
            <el-badge v-if="row.open_ticket_count" :value="row.open_ticket_count" type="danger" />
            <span v-else class="muted">0</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer v-model="historyVisible" :title="`故障历史 · ${current?.asset_code || ''}`" size="440px">
      <EmptyState v-if="!history.length" text="该资产暂无故障记录" />
      <el-timeline v-else>
        <el-timeline-item v-for="r in history" :key="r.id" :timestamp="fmtTime(r.created_at)" placement="top">
          <div>
            <PriorityTag :value="r.severity" />
            <span class="h-type">{{ FaultTypeText[r.fault_type] }}</span>
            <StatusBadge kind="report" :value="r.status" />
          </div>
          <div class="muted h-desc">{{ r.address_desc }}</div>
          <div v-if="r.ticket_no" class="mono h-ticket">工单 {{ r.ticket_no }}</div>
        </el-timeline-item>
      </el-timeline>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { Refresh, Edit } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api, runAction } from '../api';
import { useAuthStore } from '../stores/auth';
import { AssetHealthStatus, AssetHealthStatusText, FaultTypeText, fmtTime } from '../constants';
import StatusBadge from '../components/StatusBadge.vue';
import PriorityTag from '../components/PriorityTag.vue';
import EmptyState from '../components/EmptyState.vue';

const auth = useAuthStore();
const assets = ref([]);
const feederLines = ref([]);
const feederLine = ref('');
const loading = ref(false);
const historyVisible = ref(false);
const history = ref([]);
const current = ref(null);

async function load() {
  loading.value = true;
  try {
    assets.value = await api('GET', `/assets${feederLine.value ? `?feeder_line=${encodeURIComponent(feederLine.value)}` : ''}`);
  } catch (err) {
    ElMessage.error(err.message);
  } finally {
    loading.value = false;
  }
}

async function setHealth(row, status) {
  await runAction(() => api('PATCH', `/assets/${row.id}/health`, { health_status: status }), '健康状态已更新');
  await load();
}

async function openHistory(row) {
  current.value = row;
  history.value = await api('GET', `/assets/${row.id}/reports`);
  historyVisible.value = true;
}

onMounted(async () => {
  load();
  feederLines.value = await api('GET', '/assets/feeder-lines').catch(() => []);
});
</script>

<style scoped>
.mono { font-family: monospace; color: #409eff; }
.health-edit { cursor: pointer; display: inline-flex; align-items: center; gap: 2px; }
.edit-icon { font-size: 12px; color: #909399; }
.h-type { margin: 0 8px; }
.h-desc { margin-top: 4px; }
.h-ticket { margin-top: 2px; font-size: 12px; }
:deep(.clickable) { cursor: pointer; }
</style>
