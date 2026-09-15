'use strict';

const { run, all, now } = require('../db');

/** 在调用方的事务内写入审计日志，保证与业务变更同生共死 */
function write(actor, action, entityType, entityId, detail) {
  run(
    'INSERT INTO audit_logs(actor_id, actor_name, actor_role, action, entity_type, entity_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)',
    [actor ? actor.id : null, actor ? actor.name : '系统', actor ? actor.role : 'system', action, entityType, entityId, detail, now()]
  );
}

function list({ entityType, entityId, action, page = 1, pageSize = 20 }) {
  const where = [];
  const params = [];
  if (entityType) { where.push('entity_type = ?'); params.push(entityType); }
  if (entityId) { where.push('entity_id = ?'); params.push(Number(entityId)); }
  if (action) { where.push('action = ?'); params.push(action); }
  const cond = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = all(`SELECT COUNT(*) AS c FROM audit_logs ${cond}`, params)[0].c;
  const rows = all(
    `SELECT * FROM audit_logs ${cond} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return { total, page, pageSize, rows };
}

module.exports = { write, list };
