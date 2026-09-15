<template>
  <div>
    <div class="page-header">
      <div>
        <h2>故障报修</h2>
        <div class="sub">同线路同类型的未闭环报修将自动合并，工单等级取最高</div>
      </div>
      <el-button v-if="auth.isDispatcher" type="primary" :icon="Plus" @click="openDialog">
        登记报修
      </el-button>
    </div>

    <el-card shadow="never">
      <div class="filter-bar">
        <el-select v-model="filters.feederLine" placeholder="馈线" clearable style="width: 160px" @change="load">
          <el-option v-for="l in feederLines" :key="l" :label="l" :value="l" />
        </el-select>
        <el-select v-model="filters.faultType" placeholder="故障类型" clearable style="width: 150px" @change="load">
          <el-option v-for="t in FaultType" :key="t" :label="FaultTypeText[t]" :value="t" />
        </el-select>
        <el-select v-model="filters.status" placeholder="报修状态" clearable style="width: 140px" @change="load">
          <el-option v-for="(text, s) in ReportStatusText" :key="s" :label="text" :value="s" />
        </el-select>
        <el-button :icon="Refresh" circle @click="load" />
      </div>

      <el-table :data="reports" v-loading="loading" stripe>
        <el-table-column prop="report_no" label="报修编号" width="90">
          <template #default="{ row }"><span class="mono">{{ row.report_no }}</span></template>
        </el-table-column>
        <el-table-column prop="reporter_name" label="报修人" width="90" />
        <el-table-column prop="phone" label="联系电话" width="120" />
        <el-table-column prop="feeder_line" label="馈线" width="130" />
        <el-table-column label="故障类型" width="100">
          <template #default="{ row }">{{ FaultTypeText[row.fault_type] }}</template>
        </el-table-column>
        <el-table-column label="等级" width="80">
          <template #default="{ row }"><PriorityTag :value="row.severity" /></template>
        </el-table-column>
        <el-table-column prop="address_desc" label="故障地址" min-width="160" show-overflow-tooltip />
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><StatusBadge kind="report" :value="row.status" /></template>
        </el-table-column>
        <el-table-column label="关联工单" width="100">
          <template #default="{ row }">
            <el-link v-if="row.ticket_no" type="primary" class="mono" @click="goTicket(row.ticket_id)">
              {{ row.ticket_no }}
            </el-link>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="登记时间" width="110">
          <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 登记报修对话框（仅调度员） -->
    <el-dialog v-model="dialogVisible" title="登记故障报修" width="560px" destroy-on-close>
      <el-form :model="form" label-width="90px">
        <el-form-item label="故障资产" required>
          <el-select v-model="form.asset_id" placeholder="选择资产（按馈线分组）" style="width: 100%" filterable>
            <el-option-group v-for="g in assetGroups" :key="g.line" :label="g.line">
              <el-option v-for="a in g.assets" :key="a.id" :value="a.id"
                :label="`${a.asset_code} · ${a.asset_type} · ${a.location_desc}`" />
            </el-option-group>
          </el-select>
        </el-form-item>
        <el-form-item label="故障类型" required>
          <el-radio-group v-model="form.fault_type">
            <el-radio-button v-for="t in FaultType" :key="t" :value="t">{{ FaultTypeText[t] }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="故障等级" required>
          <el-radio-group v-model="form.severity">
            <el-radio-button v-for="s in Severity" :key="s" :value="s">
              <el-tag :type="SeverityType[s]" size="small" effect="dark">{{ SeverityText[s] }}</el-tag>
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="报修人" required>
          <el-input v-model="form.reporter_name" placeholder="报修人姓名" />
        </el-form-item>
        <el-form-item label="联系电话" required>
          <el-input v-model="form.phone" placeholder="手机或固话" />
        </el-form-item>
        <el-form-item label="报修渠道">
          <el-select v-model="form.report_channel" style="width: 100%">
            <el-option v-for="c in ['热线', '微信', 'App', '巡检上报', '营业厅']" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="故障地址">
          <el-input v-model="form.address_desc" type="textarea" :rows="2" placeholder="补充描述故障位置与现象" />
        </el-form-item>
      </el-form>
      <el-alert v-if="mergeResult" :type="mergeResult.merged ? 'warning' : 'success'" class="result-alert"
        :closable="false" show-icon>
        <template #title>
          <template v-if="mergeResult.merged">
            已合并进未闭环工单 <b>{{ mergeResult.ticket.ticket_no }}</b>
            （当前等级：{{ SeverityText[mergeResult.ticket.priority] }}）
          </template>
          <template v-else>
            已生成新工单 <b>{{ mergeResult.ticket.ticket_no }}</b>，等待派工
          </template>
        </template>
      </el-alert>
      <template #footer>
        <el-button @click="dialogVisible = false">关闭</el-button>
        <el-button type="primary" :loading="submitting" @click="submit">提交登记</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { useAuthStore } from '../stores/auth';
import {
  FaultType, FaultTypeText, Severity, SeverityText, SeverityType, ReportStatusText, fmtTime,
} from '../constants';
import StatusBadge from '../components/StatusBadge.vue';
import PriorityTag from '../components/PriorityTag.vue';

const auth = useAuthStore();
const router = useRouter();

const reports = ref([]);
const assets = ref([]);
const feederLines = ref([]);
const loading = ref(false);
const filters = ref({ feederLine: '', faultType: '', status: '' });

const dialogVisible = ref(false);
const submitting = ref(false);
const mergeResult = ref(null);
const form = ref({});

const assetGroups = computed(() => {
  const groups = {};
  for (const a of assets.value) {
    (groups[a.feeder_line] ||= { line: a.feeder_line, assets: [] }).assets.push(a);
  }
  return Object.values(groups);
});

async function load() {
  loading.value = true;
  try {
    const q = new URLSearchParams();
    if (filters.value.feederLine) q.set('feederLine', filters.value.feederLine);
    if (filters.value.faultType) q.set('faultType', filters.value.faultType);
    if (filters.value.status) q.set('status', filters.value.status);
    reports.value = await api('GET', `/faults?${q}`);
  } catch (err) {
    ElMessage.error(err.message);
  } finally {
    loading.value = false;
  }
}

async function openDialog() {
  mergeResult.value = null;
  form.value = {
    asset_id: null, fault_type: 'OUTAGE', severity: 'MAJOR',
    reporter_name: '', phone: '', report_channel: '热线', address_desc: '',
  };
  if (!assets.value.length) {
    assets.value = await api('GET', '/assets');
  }
  dialogVisible.value = true;
}

async function submit() {
  const f = form.value;
  if (!f.asset_id) return ElMessage.warning('请选择故障资产');
  if (!f.reporter_name?.trim()) return ElMessage.warning('请填写报修人');
  if (!f.phone?.trim()) return ElMessage.warning('请填写联系电话');
  submitting.value = true;
  try {
    mergeResult.value = await api('POST', '/faults', f);
    await load();
  } catch (err) {
    ElMessage.error(err.message);
  } finally {
    submitting.value = false;
  }
}

function goTicket(id) {
  router.push({ path: '/tickets', query: { focus: id } });
}

onMounted(async () => {
  load();
  feederLines.value = await api('GET', '/assets/feeder-lines').catch(() => []);
});
</script>

<style scoped>
.mono { font-family: monospace; }
.result-alert { margin-top: 12px; }
</style>
