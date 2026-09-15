'use strict';

const { all, get } = require('../db');

/** 抢修态势总览：待派工、在途、复电待关闭、平均复电时长、班组状态、故障类型分布 */
function overview() {
  const counts = get(`
    SELECT
      SUM(CASE WHEN status = 'WAIT_DISPATCH' THEN 1 ELSE 0 END) AS wait_dispatch,
      SUM(CASE WHEN status IN ('ASSIGNED','ARRIVED','REPAIRING') THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN status = 'RESTORED' THEN 1 ELSE 0 END) AS restored,
      SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) AS closed
    FROM repair_tickets`);
  const avg = get(`
    SELECT AVG((julianday(restored_at) - julianday(created_at)) * 1440) AS minutes
    FROM repair_tickets WHERE restored_at IS NOT NULL`);
  const openReports = get(`SELECT COUNT(*) AS c FROM fault_reports WHERE status != 'CLOSED'`);

  const crews = all(`
    SELECT c.id, c.name, c.leader_name, c.duty_status, c.skill_tags,
      (SELECT t.ticket_no FROM repair_tickets t
        WHERE t.crew_id = c.id AND t.status IN ('ASSIGNED','ARRIVED','REPAIRING') LIMIT 1) AS active_ticket_no
    FROM crews c ORDER BY c.id`);

  const typeBreakdown = all(`
    SELECT fault_type AS type, COUNT(*) AS count FROM repair_tickets
    WHERE status != 'CLOSED' GROUP BY fault_type ORDER BY count DESC`);

  const recentTickets = all(`
    SELECT t.id, t.ticket_no, t.fault_type, t.feeder_line, t.priority, t.status, t.created_at, c.name AS crew_name
    FROM repair_tickets t LEFT JOIN crews c ON c.id = t.crew_id
    ORDER BY t.id DESC LIMIT 8`);

  return {
    waitDispatch: counts.wait_dispatch || 0,
    active: counts.active || 0,
    restored: counts.restored || 0,
    closed: counts.closed || 0,
    openReports: openReports.c,
    avgRestoreMinutes: avg.minutes == null ? null : Math.round(avg.minutes),
    crews: crews.map((c) => ({ ...c, skill_tags: JSON.parse(c.skill_tags) })),
    typeBreakdown,
    recentTickets,
  };
}

module.exports = { overview };
