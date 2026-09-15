'use strict';

const { tx, get, all, run } = require('../db');
const { ApiError } = require('../errors');
const { LogTemplates, renderTemplate, DutyStatus, ACTIVE_TICKET_STATUS_SQL } = require('../constants');
const audit = require('./auditService');

function decorate(crew) {
  const active = get(
    `SELECT id, ticket_no, status FROM repair_tickets
     WHERE crew_id = ? AND status IN (${ACTIVE_TICKET_STATUS_SQL}) LIMIT 1`,
    [crew.id]
  );
  return {
    ...crew,
    skill_tags: JSON.parse(crew.skill_tags),
    active_ticket: active || null,
  };
}

function listCrews() {
  return all('SELECT * FROM crews ORDER BY id').map(decorate);
}

/**
 * 针对某故障类型列出全部班组的可派性（技能/值班/在途），
 * 供派工面板禁用不可选项并展示原因。
 */
function availability(faultType) {
  return all('SELECT * FROM crews ORDER BY id').map((crew) => {
    const skills = JSON.parse(crew.skill_tags);
    const active = get(
      `SELECT ticket_no FROM repair_tickets WHERE crew_id = ? AND status IN (${ACTIVE_TICKET_STATUS_SQL}) LIMIT 1`,
      [crew.id]
    );
    let reason = null;
    if (crew.duty_status !== 'ON') reason = '未值班';
    else if (faultType && !skills.includes(faultType)) reason = '技能不匹配';
    else if (active) reason = `在途任务 ${active.ticket_no}`;
    return {
      id: crew.id,
      name: crew.name,
      leader_name: crew.leader_name,
      skill_tags: skills,
      duty_status: crew.duty_status,
      contact_phone: crew.contact_phone,
      eligible: !reason,
      reason,
    };
  });
}

/** 调度员切换班组值班状态；有在途任务的班组不能下班 */
function setDuty(actor, crewId, dutyStatus) {
  if (!DutyStatus.includes(dutyStatus)) throw new ApiError('VALIDATION_ERROR', '值班状态不合法');
  return tx(() => {
    const crew = get('SELECT * FROM crews WHERE id = ?', [Number(crewId)]);
    if (!crew) throw new ApiError('NOT_FOUND', '班组不存在');
    if (dutyStatus === 'OFF') {
      const active = get(
        `SELECT ticket_no FROM repair_tickets WHERE crew_id = ? AND status IN (${ACTIVE_TICKET_STATUS_SQL}) LIMIT 1`,
        [crew.id]
      );
      if (active) throw new ApiError('CREW_BUSY', `班组正在执行 ${active.ticket_no}，不能下班`);
    }
    run('UPDATE crews SET duty_status = ? WHERE id = ?', [dutyStatus, crew.id]);
    audit.write(actor, 'CREW_DUTY_CHANGED', 'CREW', crew.id,
      renderTemplate(LogTemplates.CREW_DUTY_CHANGED, { crewName: crew.name, dutyStatus }));
    return decorate(get('SELECT * FROM crews WHERE id = ?', [crew.id]));
  });
}

module.exports = { listCrews, availability, setDuty };
