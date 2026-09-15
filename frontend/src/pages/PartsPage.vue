<template>
  <div>
    <div class="page-header">
      <div>
        <h2>备件库存</h2>
        <div class="sub">领用审批、出入库与库存流水，超量领用自动拦截</div>
      </div>
      <el-button :icon="Refresh" circle :loading="loading" @click="loadAll" />
    </div>

    <el-row :gutter="16">
      <el-col :span="14">
        <el-card shadow="never" class="mb16">
          <template #header>库存台账</template>
          <el-table :data="parts" v-loading="loading" size="small" stripe>
            <el-table-column prop="part_code" label="编码" width="90">
              <template #default="{ row }"><span class="mono">{{ row.part_code }}</span></template>
            </el-table-column>
            <el-table-column prop="part_name" label="备件名称" min-width="130" />
            <el-table-column prop="warehouse_name" label="仓库" width="90" />
            <el-table-column prop="total_qty" label="总量" width="70" align="right" />
            <el-table-column label="可用" width="90" align="right">
              <template #default="{ row }">
                <el-tag :type="row.available_qty === 0 ? 'danger' : row.available_qty <= 3 ? 'warning' : 'success'"
                  effect="dark" size="small">
                  {{ row.available_qty }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column v-if="auth.isKeeper" label="操作" width="90">
              <template #default="{ row }">
                <el-button size="small" type="primary" plain @click="openRestock(row)">入库</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card shadow="never">
          <template #header>库存流水</template>
          <el-table :data="stockLogs" size="small" max-height="320">
            <el-table-column label="时间" width="100">
              <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
            </el-table-column>
            <el-table-column prop="part_name" label="备件" min-width="110" />
            <el-table-column label="变动" width="80" align="right">
              <template #default="{ row }">
                <span :class="row.change_qty > 0 ? 'in' : 'out'">
                  {{ row.change_qty > 0 ? '+' : '' }}{{ row.change_qty }}
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="balance_after" label="结余" width="70" align="right" />
            <el-table-column prop="reason" label="事由" min-width="160" show-overflow-tooltip />
          </el-table>
        </el-card>
      </el-col>

      <el-col :span="10">
        <el-card v-if="auth.isKeeper" shadow="never" class="mb16">
          <template #header>
            <div class="head-row">
              <span>待审批申请</span>
              <el-badge v-if="pending.length" :value="pending.length" type="warning" />
            </div>
          </template>
          <EmptyState v-if="!pending.length" text="没有待审批的备件申请" />
          <div v-for="u in pending" :key="u.id" class="approval-row">
            <div>
              <b>{{ u.part_name }}</b> × {{ u.quantity }}
              <div class="muted">
                工单 {{ u.ticket_no }} · {{ u.requested_by_name }} · {{ fmtTime(u.created_at) }}
              </div>
            </div>
            <div>
              <el-button size="small" type="success" @click="approve(u)">出库</el-button>
              <el-button size="small" type="danger" plain @click="reject(u)">驳回</el-button>
            </div>
          </div>
        </el-card>

        <el-card shadow="never">
          <template #header>领用记录</template>
          <el-table :data="usages" size="small" max-height="480">
            <el-table-column label="工单" width="90">
              <template #default="{ row }"><span class="mono">{{ row.ticket_no }}</span></template>
            </el-table-column>
            <el-table-column prop="part_name" label="备件" min-width="100" />
            <el-table-column prop="quantity" label="数量" width="60" align="right" />
            <el-table-column label="状态" width="80">
              <template #default="{ row }"><StatusBadge kind="usage" :value="row.status" /></template>
            </el-table-column>
            <el-table-column label="时间" width="96">
              <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="restockVisible" :title="`入库 · ${restockPart?.part_name || ''}`" width="380px" destroy-on-close>
      <el-form label-width="80px">
        <el-form-item label="入库数量">
          <el-input-number v-model="restockQty" :min="1" :max="10000" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="restockVisible = false">取消</el-button>
        <el-button type="primary" :loading="acting" @click="submitRestock">确认入库</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { Refresh } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, runAction } from '../api';
import { useAuthStore } from '../stores/auth';
import { fmtTime } from '../constants';
import StatusBadge from '../components/StatusBadge.vue';
import EmptyState from '../components/EmptyState.vue';

const auth = useAuthStore();
const parts = ref([]);
const usages = ref([]);
const stockLogs = ref([]);
const loading = ref(false);
const acting = ref(false);
const restockVisible = ref(false);
const restockPart = ref(null);
const restockQty = ref(10);

const pending = computed(() => usages.value.filter((u) => u.status === 'REQUESTED'));

async function loadAll() {
  loading.value = true;
  try {
    [parts.value, usages.value, stockLogs.value] = await Promise.all([
      api('GET', '/parts'),
      api('GET', '/usages'),
      api('GET', '/stock-logs').catch(() => []),
    ]);
  } catch (err) {
    ElMessage.error(err.message);
  } finally {
    loading.value = false;
  }
}

async function approve(u) {
  await runAction(() => api('POST', `/usages/${u.id}/approve`), '已审批出库');
  await loadAll();
}

async function reject(u) {
  let value = '';
  try {
    ({ value } = await ElMessageBox.prompt('请输入驳回原因', '驳回申请', {
      confirmButtonText: '确认驳回',
      cancelButtonText: '取消',
      inputPlaceholder: '如：规格不符 / 库存优先保障危急工单',
    }));
  } catch {
    return; // 用户取消
  }
  await runAction(() => api('POST', `/usages/${u.id}/reject`, { reason: value || '' }), '已驳回');
  await loadAll();
}

function openRestock(part) {
  restockPart.value = part;
  restockQty.value = 10;
  restockVisible.value = true;
}

async function submitRestock() {
  acting.value = true;
  try {
    await runAction(
      () => api('POST', `/parts/${restockPart.value.id}/restock`, { quantity: restockQty.value }),
      '入库成功',
    );
    restockVisible.value = false;
    await loadAll();
  } catch { /* 已提示 */ } finally {
    acting.value = false;
  }
}

onMounted(loadAll);
</script>

<style scoped>
.mono { font-family: monospace; }
.mb16 { margin-bottom: 16px; }
.head-row { display: flex; align-items: center; gap: 8px; }
.approval-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 0; border-bottom: 1px dashed #ebeef5;
}
.in { color: #67c23a; font-weight: 600; }
.out { color: #f56c6c; font-weight: 600; }
</style>
