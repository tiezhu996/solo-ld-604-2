'use strict';

const { tx, get, all, run, now } = require('../db');
const { ApiError } = require('../errors');
const { ACTIVE_TICKET_STATUS, LogTemplates, renderTemplate } = require('../constants');
const audit = require('./auditService');

function getUsageOrThrow(id) {
  const usage = get(
    `SELECT pu.*, sp.part_name, sp.part_code, t.ticket_no, t.crew_id, t.status AS ticket_status
     FROM part_usages pu
     JOIN spare_parts sp ON sp.id = pu.part_id
     JOIN repair_tickets t ON t.id = pu.ticket_id
     WHERE pu.id = ?`,
    [Number(id)]
  );
  if (!usage) throw new ApiError('NOT_FOUND', '备件领用单不存在');
  return usage;
}

/** 班组长为本班组在途工单申请备件；申请量不得超过可用库存（超量拦截） */
function requestPart(actor, ticketId, partId, quantity) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) throw new ApiError('VALIDATION_ERROR', '领用数量必须为正整数');

  return tx(() => {
    const ticket = get('SELECT * FROM repair_tickets WHERE id = ?', [Number(ticketId)]);
    if (!ticket) throw new ApiError('NOT_FOUND', '工单不存在');
    if (!actor.crew_id || ticket.crew_id !== actor.crew_id) {
      throw new ApiError('FORBIDDEN', '只能为本班组的工单申请备件');
    }
    if (!ACTIVE_TICKET_STATUS.includes(ticket.status)) {
      throw new ApiError('TICKET_BAD_STATE', '仅在途工单可以申请备件');
    }
    const part = get('SELECT * FROM spare_parts WHERE id = ?', [Number(partId)]);
    if (!part) throw new ApiError('NOT_FOUND', '备件不存在');
    if (qty > part.available_qty) {
      throw new ApiError('STOCK_INSUFFICIENT',
        `「${part.part_name}」可用库存 ${part.available_qty}，申请 ${qty} 已超量`);
    }
    const id = run(
      `INSERT INTO part_usages(ticket_id, part_id, quantity, status, requested_by, created_at)
       VALUES (?,?,?,'REQUESTED',?,?)`,
      [ticket.id, part.id, qty, actor.id, now()]
    );
    audit.write(actor, 'PART_REQUESTED', 'PART_USAGE', id,
      renderTemplate(LogTemplates.PART_REQUESTED, {
        ticketNo: ticket.ticket_no, partName: part.part_name, quantity: qty,
      }));
    return getUsageOrThrow(id);
  });
}

/** 仓管审批：事务内复核可用库存并扣减，超量则整体失败 */
function approve(actor, usageId) {
  return tx(() => {
    const usage = getUsageOrThrow(usageId);
    if (usage.status !== 'REQUESTED') throw new ApiError('USAGE_BAD_STATE', '该申请已处理，请刷新查看');
    const part = get('SELECT * FROM spare_parts WHERE id = ?', [usage.part_id]);
    if (part.available_qty < usage.quantity) {
      throw new ApiError('STOCK_INSUFFICIENT',
        `「${part.part_name}」可用库存 ${part.available_qty}，不足 ${usage.quantity}，无法出库`);
    }
    run('UPDATE spare_parts SET available_qty = available_qty - ? WHERE id = ?', [usage.quantity, part.id]);
    const balance = get('SELECT available_qty AS q FROM spare_parts WHERE id = ?', [part.id]).q;
    run(`UPDATE part_usages SET status = 'APPROVED', approved_by = ?, resolved_at = ? WHERE id = ?`,
      [actor.id, now(), usage.id]);
    run(`INSERT INTO stock_logs(part_id, change_qty, balance_after, reason, ref_type, ref_id, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      [part.id, -usage.quantity, balance, `领用出库（${usage.ticket_no}）`, 'PART_USAGE', usage.id, now()]);
    audit.write(actor, 'PART_APPROVED', 'PART_USAGE', usage.id,
      renderTemplate(LogTemplates.PART_APPROVED, {
        partName: part.part_name, quantity: usage.quantity, available: balance,
      }));
    return getUsageOrThrow(usage.id);
  });
}

/** 仓管驳回：不占用库存，仅记录原因 */
function reject(actor, usageId, reason) {
  return tx(() => {
    const usage = getUsageOrThrow(usageId);
    if (usage.status !== 'REQUESTED') throw new ApiError('USAGE_BAD_STATE', '该申请已处理，请刷新查看');
    run(`UPDATE part_usages SET status = 'REJECTED', approved_by = ?, reject_reason = ?, resolved_at = ? WHERE id = ?`,
      [actor.id, String(reason || ''), now(), usage.id]);
    audit.write(actor, 'PART_REJECTED', 'PART_USAGE', usage.id,
      renderTemplate(LogTemplates.PART_REJECTED, {
        partName: usage.part_name, quantity: usage.quantity, reason: reason || '未填写',
      }));
    return getUsageOrThrow(usage.id);
  });
}

/** 班组长退回已领用备件：库存同步回补 */
function returnPart(actor, usageId) {
  return tx(() => {
    const usage = getUsageOrThrow(usageId);
    if (usage.status !== 'APPROVED') throw new ApiError('USAGE_BAD_STATE', '仅已领用的备件可以退回');
    if (!actor.crew_id || usage.crew_id !== actor.crew_id) {
      throw new ApiError('FORBIDDEN', '只能退回本班组工单的备件');
    }
    run('UPDATE spare_parts SET available_qty = available_qty + ? WHERE id = ?', [usage.quantity, usage.part_id]);
    const balance = get('SELECT available_qty AS q FROM spare_parts WHERE id = ?', [usage.part_id]).q;
    run(`UPDATE part_usages SET status = 'RETURNED', resolved_at = ? WHERE id = ?`, [now(), usage.id]);
    run(`INSERT INTO stock_logs(part_id, change_qty, balance_after, reason, ref_type, ref_id, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      [usage.part_id, usage.quantity, balance, `退回归库（${usage.ticket_no}）`, 'PART_USAGE', usage.id, now()]);
    audit.write(actor, 'PART_RETURNED', 'PART_USAGE', usage.id,
      renderTemplate(LogTemplates.PART_RETURNED, {
        partName: usage.part_name, quantity: usage.quantity, available: balance,
      }));
    return getUsageOrThrow(usage.id);
  });
}

/** 班组长核销已领用备件（装表消耗，不退库存） */
function consume(actor, usageId) {
  return tx(() => {
    const usage = getUsageOrThrow(usageId);
    if (usage.status !== 'APPROVED') throw new ApiError('USAGE_BAD_STATE', '仅已领用的备件可以核销');
    if (!actor.crew_id || usage.crew_id !== actor.crew_id) {
      throw new ApiError('FORBIDDEN', '只能核销本班组工单的备件');
    }
    run(`UPDATE part_usages SET status = 'CONSUMED', resolved_at = ? WHERE id = ?`, [now(), usage.id]);
    audit.write(actor, 'PART_CONSUMED', 'PART_USAGE', usage.id,
      renderTemplate(LogTemplates.PART_CONSUMED, { partName: usage.part_name, quantity: usage.quantity }));
    return getUsageOrThrow(usage.id);
  });
}

/** 仓管入库 */
function restock(actor, partId, quantity) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty <= 0) throw new ApiError('VALIDATION_ERROR', '入库数量必须为正整数');
  return tx(() => {
    const part = get('SELECT * FROM spare_parts WHERE id = ?', [Number(partId)]);
    if (!part) throw new ApiError('NOT_FOUND', '备件不存在');
    run('UPDATE spare_parts SET total_qty = total_qty + ?, available_qty = available_qty + ? WHERE id = ?',
      [qty, qty, part.id]);
    const balance = get('SELECT available_qty AS q FROM spare_parts WHERE id = ?', [part.id]).q;
    run(`INSERT INTO stock_logs(part_id, change_qty, balance_after, reason, ref_type, ref_id, created_at)
         VALUES (?,?,?,?,?,?,?)`,
      [part.id, qty, balance, '采购入库', 'RESTOCK', null, now()]);
    audit.write(actor, 'PART_RESTOCKED', 'PART', part.id,
      renderTemplate(LogTemplates.PART_RESTOCKED, { partName: part.part_name, quantity: qty, available: balance }));
    return get('SELECT * FROM spare_parts WHERE id = ?', [part.id]);
  });
}

function listParts() {
  return all('SELECT * FROM spare_parts ORDER BY id');
}

function listUsages({ status, ticketId } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('pu.status = ?'); params.push(status); }
  if (ticketId) { where.push('pu.ticket_id = ?'); params.push(Number(ticketId)); }
  const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return all(
    `SELECT pu.*, sp.part_name, sp.part_code, sp.warehouse_name, t.ticket_no,
            ru.name AS requested_by_name, au.name AS approved_by_name
     FROM part_usages pu
     JOIN spare_parts sp ON sp.id = pu.part_id
     JOIN repair_tickets t ON t.id = pu.ticket_id
     LEFT JOIN users ru ON ru.id = pu.requested_by
     LEFT JOIN users au ON au.id = pu.approved_by
     ${cond} ORDER BY pu.id DESC LIMIT 200`,
    params
  );
}

function listStockLogs(partId) {
  const cond = partId ? 'WHERE sl.part_id = ?' : '';
  const params = partId ? [Number(partId)] : [];
  return all(
    `SELECT sl.*, sp.part_name, sp.part_code FROM stock_logs sl
     JOIN spare_parts sp ON sp.id = sl.part_id
     ${cond} ORDER BY sl.id DESC LIMIT 200`,
    params
  );
}

module.exports = {
  requestPart, approve, reject, returnPart, consume, restock,
  listParts, listUsages, listStockLogs,
};
