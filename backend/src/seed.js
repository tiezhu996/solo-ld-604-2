'use strict';

/**
 * 种子数据：班组、用户、资产、备件，以及若干处于不同状态的报修/工单，
 * 让系统开箱即有可演示的真实数据链路。
 * 直接运行 `node src/seed.js` 会删除现有数据文件并重建。
 */
const fs = require('fs');
const { initDb, tx, run, get, all, now, DB_FILE } = require('./db');

const DEFAULT_PASSWORD = '123456';

function minutesAgo(n) {
  return new Date(Date.now() - n * 60000).toISOString();
}

function seedIfEmpty() {
  const row = get('SELECT COUNT(*) AS c FROM users');
  if (row.c > 0) return false;
  tx(() => seed());
  return true;
}

function seed() {
  // ---------- 班组 ----------
  const crews = [
    ['抢修一班', '王强', JSON.stringify(['OUTAGE', 'TRIP']), 'ON', '13800000001'],
    ['抢修二班', '李建国', JSON.stringify(['EQUIPMENT_DAMAGE', 'SAFETY_RISK']), 'ON', '13800000002'],
    ['抢修三班', '张伟', JSON.stringify(['OUTAGE', 'VOLTAGE_LOW', 'TRIP', 'EQUIPMENT_DAMAGE', 'SAFETY_RISK']), 'ON', '13800000003'],
    ['抢修四班', '刘明', JSON.stringify(['VOLTAGE_LOW', 'OUTAGE']), 'OFF', '13800000004'],
  ];
  const crewIds = crews.map((c) =>
    run('INSERT INTO crews(name, leader_name, skill_tags, duty_status, contact_phone) VALUES (?,?,?,?,?)', c)
  );

  // ---------- 用户 ----------
  const users = [
    ['dispatcher01', '陈静', 'dispatcher', null],
    ['leader01', '王强', 'leader', crewIds[0]],
    ['leader02', '李建国', 'leader', crewIds[1]],
    ['leader03', '张伟', 'leader', crewIds[2]],
    ['leader04', '刘明', 'leader', crewIds[3]],
    ['keeper01', '赵敏', 'keeper', null],
    ['auditor01', '孙丽', 'auditor', null],
  ];
  const userIds = {};
  for (const [username, name, role, crewId] of users) {
    userIds[username] = run(
      'INSERT INTO users(username, password, name, role, crew_id, created_at) VALUES (?,?,?,?,?,?)',
      [username, DEFAULT_PASSWORD, name, role, crewId, now()]
    );
  }

  // ---------- 配网资产 ----------
  const assets = [
    ['CD1-TR-01', '配电变压器', '10kV城东一线', '10kV', '城东街道建设路 12 号', 'NORMAL', crewIds[0]],
    ['CD1-SW-02', '柱上开关', '10kV城东一线', '10kV', '城东街道解放路口', 'WATCH', crewIds[0]],
    ['CD2-TR-01', '配电变压器', '10kV城东二线', '10kV', '城东工业园 3 号厂房', 'NORMAL', crewIds[2]],
    ['CX1-TR-01', '配电变压器', '10kV城西一线', '10kV', '城西居民区 5 号楼', 'DEGRADED', crewIds[1]],
    ['CX1-LT-03', '低压分支箱', '10kV城西一线', '0.4kV', '城西居民区 7 号楼', 'NORMAL', crewIds[1]],
    ['CN1-TR-02', '配电变压器', '10kV城南一线', '10kV', '城南农贸市场东侧', 'NORMAL', crewIds[2]],
    ['CN1-SW-01', '环网柜', '10kV城南一线', '10kV', '城南大道与沿河路交叉口', 'WATCH', crewIds[2]],
    ['CD2-CB-05', '电缆分接箱', '10kV城东二线', '10kV', '城东工业园 7 号路', 'DANGEROUS', crewIds[2]],
  ];
  const assetIds = assets.map((a) =>
    run('INSERT INTO grid_assets(asset_code, asset_type, feeder_line, voltage_level, location_desc, health_status, owner_crew_id) VALUES (?,?,?,?,?,?,?)', a)
  );

  // ---------- 备件库存 ----------
  const parts = [
    ['BLQ-10', '10kV避雷器', '中心仓库', 20, 12],
    ['DL-95', '95mm² 电缆（米）', '中心仓库', 500, 320],
    ['KG-10', '柱上开关', '中心仓库', 8, 3],
    ['BX-400', '400kVA 变压器', '东区仓库', 4, 1],
    ['JYZ-01', '绝缘子串', '东区仓库', 60, 45],
    ['RDQ-10', '10kV熔断器', '中心仓库', 30, 0],
  ];
  const partIds = parts.map((p) =>
    run('INSERT INTO spare_parts(part_code, part_name, warehouse_name, total_qty, available_qty) VALUES (?,?,?,?,?)', p)
  );
  for (const [i, p] of parts.entries()) {
    run('INSERT INTO stock_logs(part_id, change_qty, balance_after, reason, ref_type, ref_id, created_at) VALUES (?,?,?,?,?,?,?)',
      [partIds[i], p[4], p[4], '期初建账', 'RESTOCK', null, minutesAgo(4320)]);
  }

  // ---------- 历史已闭环工单（供态势页统计平均复电时长） ----------
  const closedTicketId = run(
    `INSERT INTO repair_tickets(ticket_no, fault_type, feeder_line, asset_id, address_desc, priority, status,
      crew_id, dispatcher_id, dispatch_mode, created_at, assigned_at, arrived_at, repair_started_at, restored_at, closed_at)
     VALUES ('WO-0001','TRIP','10kV城东一线',?,'城东街道解放路口','MAJOR','CLOSED',?,?, 'MANUAL',?,?,?,?,?,?)`,
    [assetIds[1], crewIds[0], userIds.dispatcher01,
     minutesAgo(1500), minutesAgo(1495), minutesAgo(1460), minutesAgo(1450), minutesAgo(1370), minutesAgo(1360)]
  );
  run(
    `INSERT INTO fault_reports(report_no, reporter_name, phone, asset_id, feeder_line, fault_type, address_desc,
      severity, report_channel, status, ticket_id, created_by, created_at)
     VALUES ('BX-0001','周先生','13911110001',?,'10kV城东一线','TRIP','城东街道解放路口','MAJOR','热线','CLOSED',?,?,?)`,
    [assetIds[1], closedTicketId, userIds.dispatcher01, minutesAgo(1500)]
  );

  // ---------- 在途工单：抢修一班处理中 ----------
  const activeTicketId = run(
    `INSERT INTO repair_tickets(ticket_no, fault_type, feeder_line, asset_id, address_desc, priority, status,
      crew_id, dispatcher_id, dispatch_mode, created_at, assigned_at, arrived_at, repair_started_at)
     VALUES ('WO-0002','OUTAGE','10kV城西一线',?,'城西居民区 5 号楼','CRITICAL','REPAIRING',?,?, 'MANUAL',?,?,?,?)`,
    [assetIds[3], crewIds[0], userIds.dispatcher01, minutesAgo(95), minutesAgo(90), minutesAgo(60), minutesAgo(50)]
  );
  run(
    `INSERT INTO fault_reports(report_no, reporter_name, phone, asset_id, feeder_line, fault_type, address_desc,
      severity, report_channel, status, ticket_id, created_by, created_at)
     VALUES ('BX-0002','吴女士','13911110002',?,'10kV城西一线','OUTAGE','城西居民区 5 号楼','CRITICAL','热线','CONVERTED',?,?,?)`,
    [assetIds[3], activeTicketId, userIds.dispatcher01, minutesAgo(95)]
  );
  run(
    `INSERT INTO fault_reports(report_no, reporter_name, phone, asset_id, feeder_line, fault_type, address_desc,
      severity, report_channel, status, ticket_id, created_by, created_at)
     VALUES ('BX-0003','郑先生','13911110003',?,'10kV城西一线','OUTAGE','城西居民区 7 号楼','MAJOR','微信','MERGED',?,?,?)`,
    [assetIds[4], activeTicketId, userIds.dispatcher01, minutesAgo(80)]
  );

  // ---------- 待派工工单（等待派工，演示补派排序） ----------
  const waiting1 = run(
    `INSERT INTO repair_tickets(ticket_no, fault_type, feeder_line, asset_id, address_desc, priority, status,
      dispatch_mode, created_at)
     VALUES ('WO-0003','EQUIPMENT_DAMAGE','10kV城东二线',?,'城东工业园 7 号路电缆分接箱烧损','CRITICAL','WAIT_DISPATCH', NULL, ?)`,
    [assetIds[7], minutesAgo(40)]
  );
  run(
    `INSERT INTO fault_reports(report_no, reporter_name, phone, asset_id, feeder_line, fault_type, address_desc,
      severity, report_channel, status, ticket_id, created_by, created_at)
     VALUES ('BX-0004','林先生','13911110004',?,'10kV城东二线','EQUIPMENT_DAMAGE','城东工业园 7 号路','CRITICAL','巡检上报','CONVERTED',?,?,?)`,
    [assetIds[7], waiting1, userIds.dispatcher01, minutesAgo(40)]
  );
  const waiting2 = run(
    `INSERT INTO repair_tickets(ticket_no, fault_type, feeder_line, asset_id, address_desc, priority, status,
      dispatch_mode, created_at)
     VALUES ('WO-0004','VOLTAGE_LOW','10kV城南一线',?,'城南农贸市场东侧电压偏低','MINOR','WAIT_DISPATCH', NULL, ?)`,
    [assetIds[5], minutesAgo(30)]
  );
  run(
    `INSERT INTO fault_reports(report_no, reporter_name, phone, asset_id, feeder_line, fault_type, address_desc,
      severity, report_channel, status, ticket_id, created_by, created_at)
     VALUES ('BX-0005','许女士','13911110005',?,'10kV城南一线','VOLTAGE_LOW','城南农贸市场东侧','MINOR','热线','CONVERTED',?,?,?)`,
    [assetIds[5], waiting2, userIds.dispatcher01, minutesAgo(30)]
  );

  // ---------- 在途工单上的备件领用（已出库 2 只避雷器） ----------
  run(
    `INSERT INTO part_usages(ticket_id, part_id, quantity, status, requested_by, approved_by, created_at, resolved_at)
     VALUES (?,?,2,'APPROVED',?,?,?,?)`,
    [activeTicketId, partIds[0], userIds.leader01, userIds.keeper01, minutesAgo(55), minutesAgo(52)]
  );
  run('UPDATE spare_parts SET available_qty = available_qty - 2 WHERE id = ?', [partIds[0]]);
  run(
    `INSERT INTO stock_logs(part_id, change_qty, balance_after, reason, ref_type, ref_id, created_at)
     VALUES (?,-2,10,'领用出库（WO-0002）','PART_USAGE',1,?)`,
    [partIds[0], minutesAgo(52)]
  );

  // ---------- 初始审计记录 ----------
  const audits = [
    [userIds.dispatcher01, '陈静', 'dispatcher', 'TICKET_DISPATCHED', 'TICKET', activeTicketId, '工单 WO-0002 派工至班组 抢修一班', minutesAgo(90)],
    [userIds.leader01, '王强', 'leader', 'TICKET_ADVANCED', 'TICKET', activeTicketId, '工单 WO-0002 推进：ASSIGNED → ARRIVED', minutesAgo(60)],
    [userIds.leader01, '王强', 'leader', 'TICKET_ADVANCED', 'TICKET', activeTicketId, '工单 WO-0002 推进：ARRIVED → REPAIRING', minutesAgo(50)],
    [userIds.keeper01, '赵敏', 'keeper', 'PART_APPROVED', 'PART_USAGE', 1, '备件 10kV避雷器 × 2 审批出库（剩余可用 10）', minutesAgo(52)],
  ];
  for (const a of audits) {
    run('INSERT INTO audit_logs(actor_id, actor_name, actor_role, action, entity_type, entity_id, detail, created_at) VALUES (?,?,?,?,?,?,?,?)', a);
  }
}

/** 独立运行：node src/seed.js —— 重置数据库并写入种子数据 */
async function main() {
  if (fs.existsSync(DB_FILE)) fs.unlinkSync(DB_FILE);
  await initDb();
  tx(() => seed());
  const counts = {
    users: get('SELECT COUNT(*) c FROM users').c,
    crews: get('SELECT COUNT(*) c FROM crews').c,
    assets: get('SELECT COUNT(*) c FROM grid_assets').c,
    parts: get('SELECT COUNT(*) c FROM spare_parts').c,
    tickets: get('SELECT COUNT(*) c FROM repair_tickets').c,
    reports: get('SELECT COUNT(*) c FROM fault_reports').c,
  };
  console.log('种子数据已写入:', counts);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { seedIfEmpty };
