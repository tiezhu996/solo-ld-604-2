'use strict';

const { tx, get, all, run, now } = require('../db');
const { ApiError } = require('../errors');
const {
  ACTIVE_TICKET_STATUS, SeverityRank, SeverityText, TicketStatusText,
  LogTemplates, renderTemplate,
} = require('../constants');
const audit = require('./auditService');

/** 班组当前的在途工单（复电前占用班组） */
function activeTicketOfCrew(crewId) {
  return get(
    `SELECT * FROM repair_tickets WHERE crew_id = ? AND status IN ('ASSIGNED','ARRIVED','REPAIRING') LIMIT 1`,
    [crewId]
  );
}

function getTicketOrThrow(id) {
  const ticket = get('SELECT * FROM repair_tickets WHERE id = ?', [Number(id)]);
  if (!ticket) throw new ApiError('NOT_FOUND', '工单不存在');
  return ticket;
}

/**
 * 校验班组是否可承接某故障类型的工单：
 * 技能匹配、值班中、无在途任务。不满足时抛出对应错误码。
 */
function assertCrewAssignable(crewId, faultType) {
  const crew = get('SELECT * FROM crews WHERE id = ?', [Number(crewId)]);
  if (!crew) throw new ApiError('NOT_FOUND', '班组不存在');
  if (crew.duty_status !== 'ON') throw new ApiError('CREW_OFF_DUTY', `班组「${crew.name}」未在值班状态`);
  const skills = JSON.parse(crew.skill_tags);
  if (!skills.includes(faultType)) {
    throw new ApiError('CREW_SKILL_MISMATCH', `班组「${crew.name}」技能不匹配该故障类型`);
  }
  const busy = activeTicketOfCrew(crew.id);
  if (busy) throw new ApiError('CREW_BUSY', `班组「${crew.name}」正在执行 ${busy.ticket_no}，不能重复占用`);
  return crew;
}

/** 事务内派工 */
function assignTicket(ticket, crew, actor, mode) {
  const at = now();
  run(
    `UPDATE repair_tickets SET status = 'ASSIGNED', crew_id = ?, dispatcher_id = ?, dispatch_mode = ?,
       assigned_at = ?, arrived_at = NULL, repair_started_at = NULL, restored_at = NULL
     WHERE id = ?`,
    [crew.id, actor ? actor.id : null, mode, at, ticket.id]
  );
  const template = mode === 'AUTO_BACKFILL' ? LogTemplates.TICKET_AUTO_DISPATCHED : LogTemplates.TICKET_DISPATCHED;
  const action = mode === 'AUTO_BACKFILL' ? 'TICKET_AUTO_DISPATCHED' : 'TICKET_DISPATCHED';
  audit.write(actor, action, 'TICKET', ticket.id,
    renderTemplate(template, { ticketNo: ticket.ticket_no, crewName: crew.name }));
}

/** 调度员手工派工 */
function dispatch(actor, ticketId, crewId) {
  return tx(() => {
    const ticket = getTicketOrThrow(ticketId);
    if (ticket.status !== 'WAIT_DISPATCH') throw new ApiError('TICKET_NOT_WAITING');
    const crew = assertCrewAssignable(crewId, ticket.fault_type);
    assignTicket(ticket, crew, actor, 'MANUAL');
    return get('SELECT * FROM repair_tickets WHERE id = ?', [ticket.id]);
  });
}

/**
 * 补派：班组复电释放运力后，空闲值班班组按「等级降序、等待时长降序」
 * 承接排队工单；每个班组最多承接一单，绝不重复占用。
 * 必须在事务内调用。
 */
function backfillQueuedTickets(actor) {
  const assigned = [];
  for (;;) {
    const freeCrews = all(
      `SELECT c.* FROM crews c
       WHERE c.duty_status = 'ON'
         AND NOT EXISTS (
           SELECT 1 FROM repair_tickets t
           WHERE t.crew_id = c.id AND t.status IN ('ASSIGNED','ARRIVED','REPAIRING')
         )
       ORDER BY c.id`
    );
    if (!freeCrews.length) break;

    const queued = all(
      `SELECT * FROM repair_tickets WHERE status = 'WAIT_DISPATCH'
       ORDER BY CASE priority WHEN 'CRITICAL' THEN 3 WHEN 'MAJOR' THEN 2 ELSE 1 END DESC, created_at ASC`
    );
    if (!queued.length) break;

    const taken = new Set();
    let progressed = false;
    for (const crew of freeCrews) {
      const skills = JSON.parse(crew.skill_tags);
      const ticket = queued.find((t) => !taken.has(t.id) && skills.includes(t.fault_type));
      if (!ticket) continue;
      assignTicket(ticket, crew, actor, 'AUTO_BACKFILL');
      taken.add(ticket.id);
      assigned.push({ ticketId: ticket.id, crewId: crew.id });
      progressed = true;
    }
    if (!progressed) break;
  }
  return assigned;
}

const ADVANCE_FLOW = {
  arrive: { from: 'ASSIGNED', to: 'ARRIVED', field: 'arrived_at', label: '到场' },
  start_repair: { from: 'ARRIVED', to: 'REPAIRING', field: 'repair_started_at', label: '开始处理' },
  restore: { from: 'REPAIRING', to: 'RESTORED', field: 'restored_at', label: '复电' },
  close: { from: 'RESTORED', to: 'CLOSED', field: 'closed_at', label: '关闭' },
};

/**
 * 班组长推进工单：到场 → 处理 → 复电 → 关闭。
 * 复电时释放班组并触发补派；关闭时级联闭环关联报修单。
 */
function advance(actor, ticketId, action) {
  const step = ADVANCE_FLOW[action];
  if (!step) throw new ApiError('VALIDATION_ERROR', '不支持的推进动作');

  return tx(() => {
    const ticket = getTicketOrThrow(ticketId);
    if (!actor.crew_id || ticket.crew_id !== actor.crew_id) {
      throw new ApiError('FORBIDDEN', '只能操作本班组的工单');
    }
    if (ticket.status !== step.from) {
      throw new ApiError('TICKET_BAD_STATE',
        `工单当前为「${TicketStatusText[ticket.status]}」，不能执行「${step.label}」`);
    }
    if (action === 'close') {
      const openUsage = get(
        `SELECT COUNT(*) AS c FROM part_usages WHERE ticket_id = ? AND status IN ('REQUESTED','APPROVED')`,
        [ticket.id]
      );
      if (openUsage.c > 0) {
        throw new ApiError('TICKET_BAD_STATE', '工单存在未完结的备件领用，请先退回或核销后再关闭');
      }
    }

    run(`UPDATE repair_tickets SET status = ?, ${step.field} = ? WHERE id = ?`,
      [step.to, now(), ticket.id]);
    audit.write(actor, 'TICKET_ADVANCED', 'TICKET', ticket.id,
      renderTemplate(LogTemplates.TICKET_ADVANCED, {
        ticketNo: ticket.ticket_no,
        fromStatus: TicketStatusText[step.from],
        toStatus: TicketStatusText[step.to],
      }));

    let backfilled = [];
    if (action === 'restore') {
      // 复电 → 班组释放，按等级与等待时长补派排队工单
      backfilled = backfillQueuedTickets(actor);
    }
    if (action === 'close') {
      run(`UPDATE fault_reports SET status = 'CLOSED' WHERE ticket_id = ? AND status != 'CLOSED'`, [ticket.id]);
      audit.write(actor, 'TICKET_CLOSED', 'TICKET', ticket.id,
        renderTemplate(LogTemplates.TICKET_CLOSED, { ticketNo: ticket.ticket_no }));
    }
    return { ticket: get('SELECT * FROM repair_tickets WHERE id = ?', [ticket.id]), backfilled };
  });
}

/**
 * 改派/撤回：释放原班组占用，并将该工单上已领用未消耗的备件同步释放回库存，
 * 然后改派到新班组或退回待派工队列。全部在单事务内完成。
 */
function reassign(actor, ticketId, newCrewId) {
  return tx(() => {
    const ticket = getTicketOrThrow(ticketId);
    if (!ACTIVE_TICKET_STATUS.includes(ticket.status)) {
      throw new ApiError('TICKET_BAD_STATE', '仅在途工单可以改派');
    }
    const fromCrew = get('SELECT * FROM crews WHERE id = ?', [ticket.crew_id]);

    // 同步释放备件占用：已领用未消耗/未退回的备件退回库存
    const usages = all(
      `SELECT pu.*, sp.part_name, sp.available_qty FROM part_usages pu
       JOIN spare_parts sp ON sp.id = pu.part_id
       WHERE pu.ticket_id = ? AND pu.status = 'APPROVED'`,
      [ticket.id]
    );
    for (const u of usages) {
      run('UPDATE spare_parts SET available_qty = available_qty + ? WHERE id = ?', [u.quantity, u.part_id]);
      const balance = get('SELECT available_qty AS q FROM spare_parts WHERE id = ?', [u.part_id]).q;
      run(`UPDATE part_usages SET status = 'RELEASED', resolved_at = ? WHERE id = ?`, [now(), u.id]);
      run(`INSERT INTO stock_logs(part_id, change_qty, balance_after, reason, ref_type, ref_id, created_at)
           VALUES (?,?,?,?,?,?,?)`,
        [u.part_id, u.quantity, balance, `工单 ${ticket.ticket_no} 改派释放`, 'RELEASE', u.id, now()]);
      audit.write(actor, 'PART_RELEASED', 'PART_USAGE', u.id,
        renderTemplate(LogTemplates.PART_RELEASED, { partName: u.part_name, quantity: u.quantity, available: balance }));
    }
    // 待审批的申请单一并作废，避免悬空占用
    run(`UPDATE part_usages SET status = 'RELEASED', resolved_at = ? WHERE ticket_id = ? AND status = 'REQUESTED'`,
      [now(), ticket.id]);

    if (newCrewId) {
      const crew = assertCrewAssignable(newCrewId, ticket.fault_type);
      run(`UPDATE repair_tickets SET status = 'ASSIGNED', crew_id = ?, dispatcher_id = ?, dispatch_mode = 'MANUAL',
             assigned_at = ?, arrived_at = NULL, repair_started_at = NULL, restored_at = NULL WHERE id = ?`,
        [crew.id, actor.id, now(), ticket.id]);
      audit.write(actor, 'TICKET_REASSIGNED', 'TICKET', ticket.id,
        renderTemplate(LogTemplates.TICKET_REASSIGNED, {
          ticketNo: ticket.ticket_no, fromCrew: fromCrew ? fromCrew.name : '-', toCrew: crew.name,
        }));
    } else {
      run(`UPDATE repair_tickets SET status = 'WAIT_DISPATCH', crew_id = NULL, dispatcher_id = ?, dispatch_mode = NULL,
             assigned_at = NULL, arrived_at = NULL, repair_started_at = NULL, restored_at = NULL WHERE id = ?`,
        [actor.id, ticket.id]);
      audit.write(actor, 'TICKET_UNASSIGNED', 'TICKET', ticket.id,
        renderTemplate(LogTemplates.TICKET_UNASSIGNED, {
          ticketNo: ticket.ticket_no, fromCrew: fromCrew ? fromCrew.name : '-',
        }));
    }
    return get('SELECT * FROM repair_tickets WHERE id = ?', [ticket.id]);
  });
}

const TICKET_LIST_SQL = `
  SELECT t.*, c.name AS crew_name, u.name AS dispatcher_name,
    (SELECT COUNT(*) FROM fault_reports r WHERE r.ticket_id = t.id) AS report_count
  FROM repair_tickets t
  LEFT JOIN crews c ON c.id = t.crew_id
  LEFT JOIN users u ON u.id = t.dispatcher_id`;

function listTickets({ status, crewId, feederLine } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('t.status = ?'); params.push(status); }
  if (crewId) { where.push('t.crew_id = ?'); params.push(Number(crewId)); }
  if (feederLine) { where.push('t.feeder_line = ?'); params.push(feederLine); }
  const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return all(
    `${TICKET_LIST_SQL} ${cond}
     ORDER BY CASE t.status WHEN 'WAIT_DISPATCH' THEN 0 WHEN 'REPAIRING' THEN 1 WHEN 'ARRIVED' THEN 2
       WHEN 'ASSIGNED' THEN 3 WHEN 'RESTORED' THEN 4 ELSE 5 END,
       CASE t.priority WHEN 'CRITICAL' THEN 0 WHEN 'MAJOR' THEN 1 ELSE 2 END, t.created_at ASC
     LIMIT 300`,
    params
  );
}

function ticketDetail(id) {
  const ticket = get(`${TICKET_LIST_SQL} WHERE t.id = ?`, [Number(id)]);
  if (!ticket) throw new ApiError('NOT_FOUND', '工单不存在');
  const reports = all(
    `SELECT r.*, a.asset_code FROM fault_reports r LEFT JOIN grid_assets a ON a.id = r.asset_id
     WHERE r.ticket_id = ? ORDER BY r.id`, [ticket.id]
  );
  const usages = all(
    `SELECT pu.*, sp.part_name, sp.part_code, sp.warehouse_name, ru.name AS requested_by_name, au.name AS approved_by_name
     FROM part_usages pu
     JOIN spare_parts sp ON sp.id = pu.part_id
     LEFT JOIN users ru ON ru.id = pu.requested_by
     LEFT JOIN users au ON au.id = pu.approved_by
     WHERE pu.ticket_id = ? ORDER BY pu.id DESC`, [ticket.id]
  );
  const logs = all(
    `SELECT * FROM audit_logs WHERE entity_type = 'TICKET' AND entity_id = ? ORDER BY id DESC LIMIT 50`,
    [ticket.id]
  );
  return { ticket, reports, usages, logs };
}

module.exports = {
  dispatch, advance, reassign, backfillQueuedTickets,
  listTickets, ticketDetail, activeTicketOfCrew, getTicketOrThrow,
};
