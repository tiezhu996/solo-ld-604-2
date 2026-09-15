'use strict';

const { tx, get, all, run } = require('../db');
const { ApiError } = require('../errors');
const { AssetHealthStatus, LogTemplates, renderTemplate, OPEN_TICKET_STATUS_SQL } = require('../constants');
const audit = require('./auditService');

function listAssets(feederLine) {
  const cond = feederLine ? 'WHERE a.feeder_line = ?' : '';
  const params = feederLine ? [feederLine] : [];
  return all(
    `SELECT a.*, c.name AS owner_crew_name,
       (SELECT COUNT(*) FROM repair_tickets t WHERE t.asset_id = a.id AND t.status IN (${OPEN_TICKET_STATUS_SQL})) AS open_ticket_count,
       (SELECT COUNT(*) FROM fault_reports r WHERE r.asset_id = a.id) AS report_count
     FROM grid_assets a
     LEFT JOIN crews c ON c.id = a.owner_crew_id
     ${cond} ORDER BY a.feeder_line, a.asset_code`,
    params
  );
}

function assetFaultHistory(id) {
  return all(
    `SELECT r.*, t.ticket_no, t.status AS ticket_status
     FROM fault_reports r LEFT JOIN repair_tickets t ON t.id = r.ticket_id
     WHERE r.asset_id = ? ORDER BY r.id DESC LIMIT 50`,
    [Number(id)]
  );
}

function updateHealth(actor, id, healthStatus) {
  if (!AssetHealthStatus.includes(healthStatus)) throw new ApiError('VALIDATION_ERROR', '健康状态不合法');
  return tx(() => {
    const asset = get('SELECT * FROM grid_assets WHERE id = ?', [Number(id)]);
    if (!asset) throw new ApiError('NOT_FOUND', '资产不存在');
    run('UPDATE grid_assets SET health_status = ? WHERE id = ?', [healthStatus, asset.id]);
    audit.write(actor, 'ASSET_HEALTH_CHANGED', 'ASSET', asset.id,
      renderTemplate(LogTemplates.ASSET_HEALTH_CHANGED, { assetCode: asset.asset_code, healthStatus }));
    return get('SELECT * FROM grid_assets WHERE id = ?', [asset.id]);
  });
}

function feederLines() {
  return all('SELECT DISTINCT feeder_line FROM grid_assets ORDER BY feeder_line').map((r) => r.feeder_line);
}

module.exports = { listAssets, assetFaultHistory, updateHealth, feederLines };
