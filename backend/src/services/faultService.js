'use strict';

const { tx, get, all, run, now } = require('../db');
const { ApiError } = require('../errors');
const {
  SeverityRank, SeverityText, FaultTypeText, LogTemplates, renderTemplate,
} = require('../constants');
const audit = require('./auditService');

/**
 * 登记故障报修：
 * - 若存在同线路、同故障类型的未闭环工单，则合并进该工单，并按最高等级提升工单优先级；
 * - 否则以该报修的等级生成新的待派工工单。
 * 整个流程在单事务内完成。
 */
function registerFault(actor, payload) {
  const { reporter_name, phone, asset_id, fault_type, severity, address_desc, report_channel } = payload || {};
  if (!reporter_name || !String(reporter_name).trim()) throw new ApiError('VALIDATION_ERROR', '报修人姓名不能为空');
  if (!phone || !String(phone).trim()) throw new ApiError('VALIDATION_ERROR', '联系电话不能为空');
  const assetId = Number(asset_id);
  if (!assetId) throw new ApiError('VALIDATION_ERROR', '必须选择故障资产');
  if (!SeverityRank[severity]) throw new ApiError('VALIDATION_ERROR', '故障等级不合法');

  return tx(() => {
    const asset = get('SELECT * FROM grid_assets WHERE id = ?', [assetId]);
    if (!asset) throw new ApiError('NOT_FOUND', '故障资产不存在');
    if (!FaultTypeText[fault_type]) throw new ApiError('VALIDATION_ERROR', '故障类型不合法');

    // 同线路 + 同类型 + 仍可吸收（待派工/在途）的工单即合并目标；
    // 已复电、已关闭工单不再吸收，新报修生成独立待派工单
    const openTicket = get(
      `SELECT * FROM repair_tickets
       WHERE feeder_line = ? AND fault_type = ?
         AND status IN ('WAIT_DISPATCH','ASSIGNED','ARRIVED','REPAIRING')
       ORDER BY id DESC LIMIT 1`,
      [asset.feeder_line, fault_type]
    );

    const createdAt = now();
    let ticket = openTicket;
    let merged = false;

    if (!openTicket) {
      const ticketId = run(
        `INSERT INTO repair_tickets(ticket_no, fault_type, feeder_line, asset_id, address_desc, priority, status, created_at)
         VALUES ('', ?, ?, ?, ?, ?, 'WAIT_DISPATCH', ?)`,
        [fault_type, asset.feeder_line, asset.id, String(address_desc || ''), severity, createdAt]
      );
      const ticketNo = 'WO-' + String(ticketId).padStart(4, '0');
      run('UPDATE repair_tickets SET ticket_no = ? WHERE id = ?', [ticketNo, ticketId]);
      ticket = get('SELECT * FROM repair_tickets WHERE id = ?', [ticketId]);
      audit.write(actor, 'TICKET_CREATED', 'TICKET', ticketId,
        renderTemplate(LogTemplates.TICKET_CREATED, { ticketNo, priority: SeverityText[severity] }));
    } else {
      merged = true;
      // 按最高等级提升
      if (SeverityRank[severity] > SeverityRank[openTicket.priority]) {
        run('UPDATE repair_tickets SET priority = ? WHERE id = ?', [severity, openTicket.id]);
        audit.write(actor, 'TICKET_ESCALATED', 'TICKET', openTicket.id,
          renderTemplate(LogTemplates.TICKET_ESCALATED, { ticketNo: openTicket.ticket_no, priority: SeverityText[severity] }));
        ticket = get('SELECT * FROM repair_tickets WHERE id = ?', [openTicket.id]);
      }
    }

    const reportId = run(
      `INSERT INTO fault_reports(report_no, reporter_name, phone, asset_id, feeder_line, fault_type, address_desc,
        severity, report_channel, status, ticket_id, created_by, created_at)
       VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [String(reporter_name).trim(), String(phone).trim(), asset.id, asset.feeder_line, fault_type,
       String(address_desc || ''), severity, String(report_channel || '热线'),
       merged ? 'MERGED' : 'CONVERTED', ticket.id, actor.id, createdAt]
    );
    const reportNo = 'BX-' + String(reportId).padStart(4, '0');
    run('UPDATE fault_reports SET report_no = ? WHERE id = ?', [reportNo, reportId]);

    audit.write(actor, 'FAULT_REGISTERED', 'FAULT_REPORT', reportId,
      renderTemplate(LogTemplates.FAULT_REGISTERED, {
        reportNo, feederLine: asset.feeder_line, faultType: FaultTypeText[fault_type], severity: SeverityText[severity],
      }));
    if (merged) {
      audit.write(actor, 'FAULT_MERGED', 'TICKET', ticket.id,
        renderTemplate(LogTemplates.FAULT_MERGED, { reportNo, ticketNo: ticket.ticket_no }));
    }

    return { merged, report: get('SELECT * FROM fault_reports WHERE id = ?', [reportId]), ticket };
  });
}

function listReports({ status, feederLine, faultType } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('r.status = ?'); params.push(status); }
  if (feederLine) { where.push('r.feeder_line = ?'); params.push(feederLine); }
  if (faultType) { where.push('r.fault_type = ?'); params.push(faultType); }
  const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return all(
    `SELECT r.*, t.ticket_no, t.status AS ticket_status, a.asset_code
     FROM fault_reports r
     LEFT JOIN repair_tickets t ON t.id = r.ticket_id
     LEFT JOIN grid_assets a ON a.id = r.asset_id
     ${cond} ORDER BY r.id DESC LIMIT 200`,
    params
  );
}

module.exports = { registerFault, listReports };
