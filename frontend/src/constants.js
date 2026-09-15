/** 与后端共享的枚举与展示文案 */

export const FaultType = ['OUTAGE', 'VOLTAGE_LOW', 'TRIP', 'EQUIPMENT_DAMAGE', 'SAFETY_RISK'];
export const FaultTypeText = {
  OUTAGE: '停电故障',
  VOLTAGE_LOW: '电压异常',
  TRIP: '线路跳闸',
  EQUIPMENT_DAMAGE: '设备损坏',
  SAFETY_RISK: '安全隐患',
};

export const TicketStatus = ['WAIT_DISPATCH', 'ASSIGNED', 'ARRIVED', 'REPAIRING', 'RESTORED', 'CLOSED'];
export const TicketStatusText = {
  WAIT_DISPATCH: '待派工',
  ASSIGNED: '已派工',
  ARRIVED: '已到场',
  REPAIRING: '处理中',
  RESTORED: '已复电',
  CLOSED: '已关闭',
};
export const TicketStatusType = {
  WAIT_DISPATCH: 'warning',
  ASSIGNED: 'primary',
  ARRIVED: 'primary',
  REPAIRING: 'danger',
  RESTORED: 'success',
  CLOSED: 'info',
};

export const Severity = ['MINOR', 'MAJOR', 'CRITICAL'];
export const SeverityText = { MINOR: '一般', MAJOR: '严重', CRITICAL: '危急' };
export const SeverityType = { MINOR: 'info', MAJOR: 'warning', CRITICAL: 'danger' };

export const AssetHealthStatus = ['NORMAL', 'WATCH', 'DEGRADED', 'DANGEROUS'];
export const AssetHealthStatusText = { NORMAL: '正常', WATCH: '关注', DEGRADED: '退化', DANGEROUS: '危险' };
export const AssetHealthType = { NORMAL: 'success', WATCH: 'warning', DEGRADED: 'warning', DANGEROUS: 'danger' };

export const ReportStatusText = { CONVERTED: '已生成工单', MERGED: '已合并', CLOSED: '已闭环' };
export const ReportStatusType = { CONVERTED: 'primary', MERGED: 'warning', CLOSED: 'info' };

export const UsageStatus = ['REQUESTED', 'APPROVED', 'REJECTED', 'RETURNED', 'CONSUMED', 'RELEASED'];
export const UsageStatusText = {
  REQUESTED: '待审批',
  APPROVED: '已领用',
  REJECTED: '已驳回',
  RETURNED: '已退回',
  CONSUMED: '已消耗',
  RELEASED: '已释放',
};
export const UsageStatusType = {
  REQUESTED: 'warning',
  APPROVED: 'primary',
  REJECTED: 'danger',
  RETURNED: 'info',
  CONSUMED: 'success',
  RELEASED: 'info',
};

export const RoleText = { dispatcher: '调度员', leader: '班组长', keeper: '仓管员', auditor: '审计员' };

export const AuditActionText = {
  FAULT_REGISTERED: '登记报修',
  FAULT_MERGED: '报修合并',
  TICKET_CREATED: '生成工单',
  TICKET_ESCALATED: '等级提升',
  TICKET_DISPATCHED: '手工派工',
  TICKET_AUTO_DISPATCHED: '自动补派',
  TICKET_REASSIGNED: '工单改派',
  TICKET_UNASSIGNED: '工单撤回',
  TICKET_ADVANCED: '状态推进',
  TICKET_CLOSED: '工单关闭',
  PART_REQUESTED: '备件申请',
  PART_APPROVED: '审批出库',
  PART_REJECTED: '审批驳回',
  PART_RETURNED: '退回入库',
  PART_CONSUMED: '核销消耗',
  PART_RELEASED: '占用释放',
  PART_RESTOCKED: '采购入库',
  CREW_DUTY_CHANGED: '值班切换',
  ASSET_HEALTH_CHANGED: '健康调整',
};

export function fmtTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDuration(fromIso, toIso) {
  if (!fromIso) return '-';
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  let mins = Math.max(0, Math.round((to - from) / 60000));
  if (mins < 60) return `${mins} 分钟`;
  const h = Math.floor(mins / 60);
  mins %= 60;
  return mins ? `${h} 小时 ${mins} 分` : `${h} 小时`;
}
