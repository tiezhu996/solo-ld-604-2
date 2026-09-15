<template>
  <div>
    <div class="page-header">
      <div>
        <h2>审计日志</h2>
        <div class="sub">关键变更全程留痕，可按对象追溯</div>
      </div>
      <el-button :icon="Refresh" circle :loading="loading" @click="load" />
    </div>

    <el-card shadow="never">
      <div class="filter-bar">
        <el-select v-model="filters.entityType" placeholder="对象类型" clearable style="width: 150px" @change="reload">
          <el-option label="工单" value="TICKET" />
          <el-option label="报修单" value="FAULT_REPORT" />
          <el-option label="备件领用" value="PART_USAGE" />
          <el-option label="备件" value="PART" />
          <el-option label="班组" value="CREW" />
          <el-option label="资产" value="ASSET" />
        </el-select>
        <el-select v-model="filters.action" placeholder="动作" clearable style="width: 150px" @change="reload">
          <el-option v-for="(text, a) in AuditActionText" :key="a" :label="text" :value="a" />
        </el-select>
        <el-input-number v-model="filters.entityId" :min="1" placeholder="对象 ID" style="width: 130px"
          @change="reload" />
      </div>

      <el-table :data="rows" v-loading="loading" stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column label="时间" width="110">
          <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作人" width="120">
          <template #default="{ row }">
            {{ row.actor_name }}
            <el-tag size="small" effect="plain" class="role-tag">{{ RoleText[log_role(row)] || row.actor_role }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="动作" width="110">
          <template #default="{ row }">
            <el-tag size="small">{{ AuditActionText[row.action] || row.action }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="对象" width="140">
          <template #default="{ row }">
            <span class="mono">{{ row.entity_type }}#{{ row.entity_id ?? '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="detail" label="变更详情" min-width="320" show-overflow-tooltip />
      </el-table>

      <el-pagination class="pager" layout="total, prev, pager, next" :total="total"
        :page-size="filters.pageSize" :current-page="filters.page" @current-change="(p) => { filters.page = p; load(); }" />
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { AuditActionText, RoleText, fmtTime } from '../constants';

const rows = ref([]);
const total = ref(0);
const loading = ref(false);
const filters = ref({ entityType: '', action: '', entityId: null, page: 1, pageSize: 20 });

const log_role = (row) => row.actor_role;

async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams();
    if (filters.value.entityType) q.set('entityType', filters.value.entityType);
    if (filters.value.action) q.set('action', filters.value.action);
    if (filters.value.entityId) q.set('entityId', filters.value.entityId);
    q.set('page', filters.value.page);
    q.set('pageSize', filters.value.pageSize);
    const data = await api('GET', `/audit-logs?${q}`);
    rows.value = data.rows;
    total.value = data.total;
  } catch (err) {
    ElMessage.error(err.message);
  } finally {
    loading.value = false;
  }
}

function reload() {
  filters.value.page = 1;
  load();
}

onMounted(load);
</script>

<style scoped>
.mono { font-family: monospace; font-size: 12px; }
.role-tag { margin-left: 4px; }
.pager { margin-top: 14px; justify-content: flex-end; }
</style>
