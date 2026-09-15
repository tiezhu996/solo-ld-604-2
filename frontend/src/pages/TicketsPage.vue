<template>
  <div>
    <div class="page-header">
      <div>
        <h2>抢修工单</h2>
        <div class="sub">派工 → 到场 → 处理 → 复电 → 关闭，复电后自动补派排队工单</div>
      </div>
      <el-button :icon="Refresh" circle :loading="loading" @click="load" />
    </div>

    <el-card shadow="never">
      <div class="filter-bar">
        <el-select v-model="filters.status" placeholder="工单状态" clearable style="width: 140px" @change="load">
          <el-option v-for="(text, s) in TicketStatusText" :key="s" :label="text" :value="s" />
        </el-select>
        <el-select v-model="filters.crewId" placeholder="承接班组" clearable style="width: 140px" @change="load">
          <el-option v-for="c in crews" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-checkbox v-if="auth.isLeader" v-model="onlyMine" @change="load">只看我班组的</el-checkbox>
      </div>

      <el-table :data="tickets" v-loading="loading" stripe @row-click="openDetail" row-class-name="clickable">
        <el-table-column label="工单号" width="90">
          <template #default="{ row }"><span class="mono">{{ row.ticket_no }}</span></template>
        </el-table-column>
        <el-table-column label="故障类型" width="96">
          <template #default="{ row }">{{ FaultTypeText[row.fault_type] }}</template>
        </el-table-column>
        <el-table-column prop="feeder_line" label="馈线" width="120" />
        <el-table-column label="等级" width="76">
          <template #default="{ row }"><PriorityTag :value="row.priority" /></template>
        </el-table-column>
        <el-table-column label="状态" width="92">
          <template #default="{ row }">
            <StatusBadge kind="ticket" :value="row.status" />
            <el-tooltip v-if="row.dispatch_mode === 'AUTO_BACKFILL'" content="复电后自动补派">
              <span class="auto-tag">补</span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="承接班组" width="100">
          <template #default="{ row }">{{ row.crew_name || '—' }}</template>
        </el-table-column>
        <el-table-column label="报修" width="60">
          <template #default="{ row }">
            <el-badge :value="row.report_count" type="primary" :max="99" />
          </template>
        </el-table-column>
        <el-table-column label="等待/处置时长" width="120">
          <template #default="{ row }">
            <span v-if="row.status === 'WAIT_DISPATCH'" class="waiting">
              已等 {{ fmtDuration(row.created_at) }}
            </span>
            <span v-else-if="row.restored_at">{{ fmtDuration(row.created_at, row.restored_at) }} 复电</span>
            <span v-else>{{ fmtDuration(row.created_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="address_desc" label="地址" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <div @click.stop>
              <!-- 调度员动作 -->
              <template v-if="auth.isDispatcher">
                <el-button v-if="row.status === 'WAIT_DISPATCH'" type="primary" size="small"
                  @click="openDispatch(row)">派工</el-button>
                <el-button v-if="isActive(row)" type="warning" size="small" plain
                  @click="openReassign(row)">改派</el-button>
              </template>
              <!-- 班组长动作 -->
              <template v-if="auth.isLeader && row.crew_id === auth.user.crewId">
                <el-button v-if="row.status === 'ASSIGNED'" type="primary" size="small"
                  @click="advance(row, 'arrive', '到场')">到场</el-button>
                <el-button v-if="row.status === 'ARRIVED'" type="primary" size="small"
                  @click="advance(row, 'start_repair', '开始处理')">开始处理</el-button>
                <el-button v-if="row.status === 'REPAIRING'" type="success" size="small"
                  @click="advance(row, 'restore', '复电')">复电</el-button>
                <el-button v-if="row.status === 'RESTORED'" type="info" size="small"
                  @click="advance(row, 'close', '关闭')">关闭</el-button>
                <el-button v-if="isActive(row)" size="small" plain @click="openPartDialog(row)">领备件</el-button>
              </template>
              <el-button size="small" text type="primary" @click="openDetail(row)">详情</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <EmptyState v-if="!loading && !tickets.length" text="暂无工单" />
    </el-card>

    <!-- 派工对话框 -->
    <el-dialog v-model="dispatchVisible" :title="`派工 · ${current?.ticket_no || ''}`" width="520px" destroy-on-close>
      <el-alert type="info" :closable="false" class="mb12"
        :title="`故障类型：${FaultTypeText[current?.fault_type]}，仅可派给技能匹配、值班中且无在途任务的班组`" />
      <div v-for="c in crewOptions" :key="c.id" class="crew-option"
        :class="{ disabled: !c.eligible, selected: selectedCrew === c.id }"
        @click="c.eligible && (selectedCrew = c.id)">
        <div>
          <b>{{ c.name }}</b>
          <span class="muted">（{{ c.leader_name }}）</span>
          <div class="skills">
            <el-tag v-for="s in c.skill_tags" :key="s" size="small" effect="plain">{{ FaultTypeText[s] }}</el-tag>
          </div>
        </div>
        <el-tag v-if="c.eligible" type="success" size="small">可派工</el-tag>
        <el-tag v-else type="info" size="small">{{ c.reason }}</el-tag>
      </div>
      <template #footer>
        <el-button @click="dispatchVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!selectedCrew" :loading="acting" @click="confirmDispatch">
          确认派工
        </el-button>
      </template>
    </el-dialog>

    <!-- 改派对话框 -->
    <el-dialog v-model="reassignVisible" :title="`改派 · ${current?.ticket_no || ''}`" width="520px" destroy-on-close>
      <el-alert type="warning" :closable="false" class="mb12"
        title="改派将同步释放该工单已领用的备件库存与班组占用" />
      <div v-for="c in crewOptions" :key="c.id" class="crew-option"
        :class="{ disabled: !c.eligible, selected: selectedCrew === c.id }"
        @click="c.eligible && (selectedCrew = c.id)">
        <div>
          <b>{{ c.name }}</b>
          <span class="muted">（{{ c.leader_name }}）</span>
          <div class="skills">
            <el-tag v-for="s in c.skill_tags" :key="s" size="small" effect="plain">{{ FaultTypeText[s] }}</el-tag>
          </div>
        </div>
        <el-tag v-if="c.eligible" type="success" size="small">可派工</el-tag>
        <el-tag v-else type="info" size="small">{{ c.reason }}</el-tag>
      </div>
      <template #footer>
        <el-button type="danger" plain :loading="acting" @click="confirmReassign(null)">
          撤回待派工
        </el-button>
        <el-button type="primary" :disabled="!selectedCrew" :loading="acting" @click="confirmReassign(selectedCrew)">
          改派到所选班组
        </el-button>
      </template>
    </el-dialog>

    <!-- 领用备件对话框 -->
    <el-dialog v-model="partVisible" :title="`申请备件 · ${current?.ticket_no || ''}`" width="480px" destroy-on-close>
      <el-form label-width="80px">
        <el-form-item label="备件">
          <el-select v-model="partForm.part_id" style="width: 100%" placeholder="选择备件" @change="partForm.quantity = 1">
            <el-option v-for="p in parts" :key="p.id" :value="p.id"
              :label="`${p.part_name}（${p.warehouse_name} · 可用 ${p.available_qty}）`"
              :disabled="p.available_qty <= 0" />
          </el-select>
        </el-form-item>
        <el-form-item label="数量">
          <el-input-number v-model="partForm.quantity" :min="1" :max="selectedPart?.available_qty || 1" />
          <span class="muted" style="margin-left: 10px">可用 {{ selectedPart?.available_qty ?? '-' }} 件，禁止超量</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="partVisible = false">取消</el-button>
        <el-button type="primary" :loading="acting" @click="submitPartRequest">提交申请</el-button>
      </template>
    </el-dialog>

    <!-- 工单详情抽屉 -->
    <el-drawer v-model="detailVisible" :title="`工单 ${detail?.ticket?.ticket_no || ''}`" size="520px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="状态">
            <StatusBadge kind="ticket" :value="detail.ticket.status" />
          </el-descriptions-item>
          <el-descriptions-item label="等级"><PriorityTag :value="detail.ticket.priority" /></el-descriptions-item>
          <el-descriptions-item label="故障类型">{{ FaultTypeText[detail.ticket.fault_type] }}</el-descriptions-item>
          <el-descriptions-item label="馈线">{{ detail.ticket.feeder_line }}</el-descriptions-item>
          <el-descriptions-item label="承接班组">{{ detail.ticket.crew_name || '—' }}</el-descriptions-item>
          <el-descriptions-item label="调度员">{{ detail.ticket.dispatcher_name || '—' }}</el-descriptions-item>
          <el-descriptions-item label="登记">{{ fmtTime(detail.ticket.created_at) }}</el-descriptions-item>
          <el-descriptions-item label="派工">{{ fmtTime(detail.ticket.assigned_at) }}</el-descriptions-item>
          <el-descriptions-item label="到场">{{ fmtTime(detail.ticket.arrived_at) }}</el-descriptions-item>
          <el-descriptions-item label="复电">{{ fmtTime(detail.ticket.restored_at) }}</el-descriptions-item>
          <el-descriptions-item label="地址" :span="2">{{ detail.ticket.address_desc || '—' }}</el-descriptions-item>
        </el-descriptions>

        <h4>关联报修（{{ detail.reports.length }}）</h4>
        <el-table :data="detail.reports" size="small">
          <el-table-column prop="report_no" label="编号" width="80">
            <template #default="{ row }"><span class="mono">{{ row.report_no }}</span></template>
          </el-table-column>
          <el-table-column prop="reporter_name" label="报修人" width="80" />
          <el-table-column label="等级" width="70">
            <template #default="{ row }"><PriorityTag :value="row.severity" /></template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }"><StatusBadge kind="report" :value="row.status" /></template>
          </el-table-column>
          <el-table-column label="时间">
            <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
          </el-table-column>
        </el-table>

        <h4>备件领用（{{ detail.usages.length }}）</h4>
        <EmptyState v-if="!detail.usages.length" text="未申请备件" />
        <div v-for="u in detail.usages" :key="u.id" class="usage-row">
          <div>
            <b>{{ u.part_name }}</b> × {{ u.quantity }}
            <StatusBadge kind="usage" :value="u.status" style="margin-left: 8px" />
            <div class="muted">
              {{ u.requested_by_name }} 申请 · {{ fmtTime(u.created_at) }}
              <template v-if="u.approved_by_name"> · {{ u.approved_by_name }} 审批</template>
              <template v-if="u.reject_reason"> · 驳回原因：{{ u.reject_reason }}</template>
            </div>
          </div>
          <div v-if="auth.isLeader && u.status === 'APPROVED' && detail.ticket.crew_id === auth.user.crewId">
            <el-button size="small" @click="resolveUsage(u, 'return')">退回</el-button>
            <el-button size="small" type="success" plain @click="resolveUsage(u, 'consume')">核销</el-button>
          </div>
        </div>

        <h4>变更轨迹</h4>
        <TimelineList :logs="detail.logs" />
      </template>
    </el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { Refresh } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api, runAction } from '../api';
import { useAuthStore } from '../stores/auth';
import { FaultTypeText, TicketStatusText, fmtTime, fmtDuration } from '../constants';
import StatusBadge from '../components/StatusBadge.vue';
import PriorityTag from '../components/PriorityTag.vue';
import TimelineList from '../components/TimelineList.vue';
import EmptyState from '../components/EmptyState.vue';

const auth = useAuthStore();
const route = useRoute();

const tickets = ref([]);
const crews = ref([]);
const parts = ref([]);
const loading = ref(false);
const acting = ref(false);
const onlyMine = ref(false);
const filters = ref({ status: '', crewId: null });

const current = ref(null);
const dispatchVisible = ref(false);
const reassignVisible = ref(false);
const partVisible = ref(false);
const detailVisible = ref(false);
const crewOptions = ref([]);
const selectedCrew = ref(null);
const partForm = ref({ part_id: null, quantity: 1 });
const detail = ref(null);

const isActive = (row) => ['ASSIGNED', 'ARRIVED', 'REPAIRING'].includes(row.status);
const selectedPart = computed(() => parts.value.find((p) => p.id === partForm.value.part_id));

async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams();
    if (filters.value.status) q.set('status', filters.value.status);
    if (filters.value.crewId) q.set('crewId', filters.value.crewId);
    if (onlyMine.value && auth.user?.crewId) q.set('crewId', auth.user.crewId);
    tickets.value = await api('GET', `/tickets?${q}`);
  } catch (err) {
    ElMessage.error(err.message);
  } finally {
    loading.value = false;
  }
}

async function loadCrewOptions(faultType) {
  crewOptions.value = await api('GET', `/crews/available?fault_type=${faultType}`);
  selectedCrew.value = null;
}

function openDispatch(row) {
  current.value = row;
  loadCrewOptions(row.fault_type);
  dispatchVisible.value = true;
}

function openReassign(row) {
  current.value = row;
  loadCrewOptions(row.fault_type);
  reassignVisible.value = true;
}

async function confirmDispatch() {
  acting.value = true;
  try {
    await runAction(
      () => api('POST', `/tickets/${current.value.id}/dispatch`, { crew_id: selectedCrew.value }),
      '派工成功',
    );
    dispatchVisible.value = false;
    await load();
  } catch { /* 已提示 */ } finally {
    acting.value = false;
  }
}

async function confirmReassign(crewId) {
  acting.value = true;
  try {
    const result = await runAction(
      () => api('POST', `/tickets/${current.value.id}/reassign`, crewId ? { crew_id: crewId } : {}),
    );
    ElMessage.success(
      result?.idempotent
        ? '相同请求已处理过，工单保持当前状态'
        : crewId
          ? '改派成功，备件占用已同步释放'
          : '已撤回待派工，备件占用已同步释放',
    );
    reassignVisible.value = false;
    await load();
  } catch { /* 已提示 */ } finally {
    acting.value = false;
  }
}

async function advance(row, action, label) {
  try {
    await ElMessageBox.confirm(`确认对工单 ${row.ticket_no} 执行「${label}」？`, '状态推进', { type: 'warning' });
  } catch {
    return; // 用户取消
  }
  const result = await runAction(
    () => api('POST', `/tickets/${row.id}/advance`, { action }),
    action === 'restore' ? '已复电，系统按等级与等待时长补派排队工单' : `已${label}`,
  );
  if (action === 'restore' && result?.backfilled?.length) {
    ElMessage.success(`自动补派 ${result.backfilled.length} 张排队工单`);
  }
  await load();
}

async function openPartDialog(row) {
  current.value = row;
  partForm.value = { part_id: null, quantity: 1 };
  parts.value = await api('GET', '/parts');
  partVisible.value = true;
}

async function submitPartRequest() {
  if (!partForm.value.part_id) return ElMessage.warning('请选择备件');
  acting.value = true;
  try {
    await runAction(
      () => api('POST', `/tickets/${current.value.id}/parts`, partForm.value),
      '备件申请已提交，等待仓管审批',
    );
    partVisible.value = false;
  } catch { /* 已提示 */ } finally {
    acting.value = false;
  }
}

async function resolveUsage(usage, action) {
  const label = action === 'return' ? '退回入库' : '核销消耗';
  runAction(() => api('POST', `/usages/${usage.id}/${action}`), `已${label}`).then(() => {
    openDetail({ id: detail.value.ticket.id });
    load();
  });
}

async function openDetail(row) {
  detail.value = await api('GET', `/tickets/${row.id}`);
  detailVisible.value = true;
}

onMounted(async () => {
  await load();
  crews.value = await api('GET', '/crews').catch(() => []);
  if (route.query.focus) {
    openDetail({ id: Number(route.query.focus) });
  }
});
</script>

<style scoped>
.mono { font-family: monospace; color: #409eff; }
.auto-tag {
  display: inline-block; margin-left: 4px; padding: 0 4px; font-size: 10px;
  color: #fff; background: #b88230; border-radius: 3px; vertical-align: middle;
}
.waiting { color: #e6a23c; }
.mb12 { margin-bottom: 12px; }
.crew-option {
  display: flex; justify-content: space-between; align-items: center;
  border: 1px solid #e4e7ed; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px;
  cursor: pointer; transition: all 0.15s;
}
.crew-option:hover { border-color: #409eff; }
.crew-option.selected { border-color: #409eff; background: #ecf5ff; }
.crew-option.disabled { opacity: 0.55; cursor: not-allowed; }
.skills { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
.usage-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0; border-bottom: 1px dashed #ebeef5;
}
h4 { margin: 18px 0 8px; color: #303133; }
:deep(.clickable) { cursor: pointer; }
</style>
