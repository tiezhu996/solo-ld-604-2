'use strict';

/** 故障类型 */
const FaultType = ['OUTAGE', 'VOLTAGE_LOW', 'TRIP', 'EQUIPMENT_DAMAGE', 'SAFETY_RISK'];
const FaultTypeText = {
  OUTAGE: '停电故障',
  VOLTAGE_LOW: '电压异常',
  TRIP: '线路跳闸',
  EQUIPMENT_DAMAGE: '设备损坏',
  SAFETY_RISK: '安全隐患',
};

/** 工单状态机：WAIT_DISPATCH → ASSIGNED → ARRIVED → REPAIRING → RESTORED → CLOSED */
const TicketStatus = ['WAIT_DISPATCH', 'ASSIGNED', 'ARRIVED', 'REPAIRING', 'RESTORED', 'CLOSED'];
const TicketStatusText = {
  WAIT_DISPATCH: '待派工',
  ASSIGNED: '已派工',
  ARRIVED: '已到场',
  REPAIRING: '处理中',
  RESTORED: '已复电',
  CLOSED: '已关闭',
};
/** 班组在途任务占用状态（复电后即释放班组） */
const ACTIVE_TICKET_STATUS = ['ASSIGNED', 'ARRIVED', 'REPAIRING'];
/** 允许吸收合并新报修的工单状态（已复电、已关闭不再吸收，新报修生成独立工单） */
const ABSORBING_TICKET_STATUS = ['WAIT_DISPATCH', 'ASSIGNED', 'ARRIVED', 'REPAIRING'];

/** 故障等级（数值越大越严重，合并时取最高） */
const Severity = ['MINOR', 'MAJOR', 'CRITICAL'];
const SeverityText = { MINOR: '一般', MAJOR: '严重', CRITICAL: '危急' };
const SeverityRank = { MINOR: 1, MAJOR: 2, CRITICAL: 3 };

/** 资产健康状态 */
const AssetHealthStatus = ['NORMAL', 'WATCH', 'DEGRADED', 'DANGEROUS'];
const AssetHealthStatusText = { NORMAL: '正常', WATCH: '关注', DEGRADED: '退化', DANGEROUS: '危险' };

/** 报修单状态 */
const ReportStatus = ['CONVERTED', 'MERGED', 'CLOSED'];
const ReportStatusText = { CONVERTED: '已生成工单', MERGED: '已合并', CLOSED: '已闭环' };

/** 备件领用状态 */
const UsageStatus = ['REQUESTED', 'APPROVED', 'REJECTED', 'RETURNED', 'CONSUMED', 'RELEASED'];
const UsageStatusText = {
  REQUESTED: '待审批',
  APPROVED: '已领用',
  REJECTED: '已驳回',
  RETURNED: '已退回',
  CONSUMED: '已消耗',
  RELEASED: '已释放',
};

/** 角色 */
const Role = ['dispatcher', 'leader', 'keeper', 'auditor'];
const RoleText = { dispatcher: '调度员', leader: '班组长', keeper: '仓管员', auditor: '审计员' };

/** 班组值班状态 */
const DutyStatus = ['ON', 'OFF'];

/** 统一错误码 */
const ErrorCodes = {
  AUTH_REQUIRED: [401, '未登录或会话已过期'],
  INVALID_CREDENTIALS: [401, '用户名或密码错误'],
  FORBIDDEN: [403, '当前角色无权执行该操作'],
  VALIDATION_ERROR: [400, '请求参数不合法'],
  NOT_FOUND: [404, '资源不存在'],
  TICKET_NOT_WAITING: [409, '工单不在待派工状态'],
  TICKET_BAD_STATE: [409, '工单当前状态不允许该操作'],
  CREW_OFF_DUTY: [409, '班组未在值班状态'],
  CREW_SKILL_MISMATCH: [409, '班组技能与故障类型不匹配'],
  CREW_BUSY: [409, '班组存在在途任务，不能重复占用'],
  STOCK_INSUFFICIENT: [409, '可用库存不足，禁止超量领用'],
  USAGE_BAD_STATE: [409, '领用单当前状态不允许该操作'],
  RATE_LIMITED: [429, '请求过于频繁，请稍后再试'],
  INTERNAL: [500, '服务器内部错误'],
};

/** 审计日志模板 */
const LogTemplates = {
  FAULT_REGISTERED: '登记故障报修 {reportNo}（{feederLine} / {faultType} / {severity}）',
  FAULT_MERGED: '报修 {reportNo} 合并入未闭环工单 {ticketNo}',
  TICKET_CREATED: '生成抢修工单 {ticketNo}，等级 {priority}',
  TICKET_ESCALATED: '工单 {ticketNo} 等级提升为 {priority}',
  TICKET_DISPATCHED: '工单 {ticketNo} 派工至班组 {crewName}',
  TICKET_AUTO_DISPATCHED: '工单 {ticketNo} 按等级与等待时长自动补派至班组 {crewName}',
  TICKET_REASSIGNED: '工单 {ticketNo} 由班组 {fromCrew} 改派至 {toCrew}，备件占用同步释放',
  TICKET_UNASSIGNED: '工单 {ticketNo} 从班组 {fromCrew} 撤回重新排队，备件占用同步释放',
  TICKET_ADVANCED: '工单 {ticketNo} 推进：{fromStatus} → {toStatus}',
  TICKET_CLOSED: '工单 {ticketNo} 关闭，关联报修单闭环',
  PART_REQUESTED: '工单 {ticketNo} 申请备件 {partName} × {quantity}',
  PART_APPROVED: '备件 {partName} × {quantity} 审批出库（剩余可用 {available}）',
  PART_REJECTED: '备件申请驳回：{partName} × {quantity}（{reason}）',
  PART_RETURNED: '备件 {partName} × {quantity} 退回入库（可用 {available}）',
  PART_CONSUMED: '备件 {partName} × {quantity} 核销消耗',
  PART_RELEASED: '工单 {ticketNo} 改派/撤回，释放备件 {partName} × {quantity}（{fromStatus} → {toStatus}，原申请人 {requestedBy}）',
  PART_RESTOCKED: '备件 {partName} 入库 {quantity} 件（可用 {available}）',
  CREW_DUTY_CHANGED: '班组 {crewName} 值班状态切换为 {dutyStatus}',
  ASSET_HEALTH_CHANGED: '资产 {assetCode} 健康状态调整为 {healthStatus}',
};

function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined ? '' : String(vars[k])));
}

module.exports = {
  FaultType, FaultTypeText,
  TicketStatus, TicketStatusText, ACTIVE_TICKET_STATUS, ABSORBING_TICKET_STATUS,
  Severity, SeverityText, SeverityRank,
  AssetHealthStatus, AssetHealthStatusText,
  ReportStatus, ReportStatusText,
  UsageStatus, UsageStatusText,
  Role, RoleText, DutyStatus,
  ErrorCodes, LogTemplates, renderTemplate,
};
