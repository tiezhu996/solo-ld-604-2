'use strict';

/**
 * 端到端测试：以独立端口 + 临时数据库启动服务，跑通
 * 登记合并 → 派工校验 → 班组推进 → 备件领用/释放 → 复电补派 → 关闭 全链路，
 * 以及 RBAC、超量、重复占用等异常分支。
 * 运行：node test/e2e.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 29904;
const BASE = `http://localhost:${PORT}/api`;
const DB_FILE = path.join(__dirname, '..', 'data', 'e2e-test.sqlite');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
  }
}

async function api(method, url, { token, body } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 空响应 */ }
  return { status: res.status, data };
}

async function login(username) {
  const { status, data } = await api('POST', '/auth/login', { body: { username, password: '123456' } });
  if (status !== 200) throw new Error(`登录失败 ${username}: ${JSON.stringify(data)}`);
  return data.token;
}

async function waitForServer(child, retries = 60) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/health`);
      if (res.ok) return;
    } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  child.kill();
  throw new Error('服务启动超时');
}

async function main() {
  fs.rmSync(DB_FILE, { force: true });
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'main.js')], {
    env: { ...process.env, PORT: String(PORT), GRID_REPAIR_DB_FILE: DB_FILE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  try {
    await waitForServer(child);

    const dispatcher = await login('dispatcher01');
    const leader1 = await login('leader01'); // 抢修一班
    const leader2 = await login('leader02'); // 抢修二班
    const leader3 = await login('leader03'); // 抢修三班
    const keeper = await login('keeper01');
    const auditor = await login('auditor01');

    // ---------- 认证与 RBAC ----------
    console.log('\n[1] 认证与角色权限');
    {
      const r = await api('GET', '/tickets');
      check('未登录访问返回 401', r.status === 401 && r.data.error.code === 'AUTH_REQUIRED');

      const bad = await api('POST', '/auth/login', { body: { username: 'dispatcher01', password: 'wrong' } });
      check('错误密码返回 401 INVALID_CREDENTIALS', bad.status === 401 && bad.data.error.code === 'INVALID_CREDENTIALS');

      const r1 = await api('POST', '/faults', { token: leader1, body: {} });
      check('班组长不能登记报修（403）', r1.status === 403 && r1.data.error.code === 'FORBIDDEN');

      const r2 = await api('POST', '/tickets/3/dispatch', { token: keeper, body: { crew_id: 2 } });
      check('仓管不能派工（403）', r2.status === 403);

      const r3 = await api('POST', '/usages/1/approve', { token: dispatcher, body: {} });
      check('调度员不能审批备件（403）', r3.status === 403);

      const r4 = await api('GET', '/audit-logs', { token: dispatcher });
      check('非审计员不能查审计日志（403）', r4.status === 403);

      const r5 = await api('POST', '/faults', { token: auditor, body: {} });
      check('审计员只读，不能登记（403）', r5.status === 403);
    }

    // ---------- 登记与合并 ----------
    console.log('\n[2] 故障登记与合并');
    let ticketA;
    let ticketD;
    let usage1Id;
    {
      // 新线路+类型 → 生成新工单
      const r = await api('POST', '/faults', {
        token: dispatcher,
        body: { reporter_name: '测试甲', phone: '13000000001', asset_id: 6, fault_type: 'TRIP', severity: 'MINOR', address_desc: '城南一线跳闸', report_channel: '热线' },
      });
      check('登记新故障生成工单', r.status === 201 && r.data.merged === false && r.data.ticket.status === 'WAIT_DISPATCH', r.data);
      check('新工单等级=报修等级', r.data.ticket.priority === 'MINOR');
      ticketA = r.data.ticket;

      // 同线路同类型未闭环 → 合并，且等级提升
      const r2 = await api('POST', '/faults', {
        token: dispatcher,
        body: { reporter_name: '测试乙', phone: '13000000002', asset_id: 7, fault_type: 'TRIP', severity: 'CRITICAL', address_desc: '城南大道环网柜跳闸', report_channel: '微信' },
      });
      check('同线路同类型合并进未闭环工单', r2.status === 201 && r2.data.merged === true && r2.data.ticket.id === ticketA.id, r2.data);
      check('合并后工单等级提升为最高', r2.data.ticket.priority === 'CRITICAL');

      // 再报一条低等级，等级不降
      const r3 = await api('POST', '/faults', {
        token: dispatcher,
        body: { reporter_name: '测试丙', phone: '13000000003', asset_id: 6, fault_type: 'TRIP', severity: 'MINOR', address_desc: '农贸市场又跳了', report_channel: '热线' },
      });
      check('低等级报修合并后不降低工单等级', r3.data.ticket.priority === 'CRITICAL');

      const detail = await api('GET', `/tickets/${ticketA.id}`, { token: dispatcher });
      check('工单关联 3 条报修记录', detail.data.reports.length === 3, detail.data.reports.length);

      // 不同故障类型不合并
      const r4 = await api('POST', '/faults', {
        token: dispatcher,
        body: { reporter_name: '测试丁', phone: '13000000004', asset_id: 6, fault_type: 'SAFETY_RISK', severity: 'MAJOR', address_desc: '变压器异响', report_channel: '热线' },
      });
      check('同线路不同类型生成独立工单', r4.data.merged === false && r4.data.ticket.id !== ticketA.id);
      ticketD = r4.data.ticket.id;

      const badReq = await api('POST', '/faults', { token: dispatcher, body: { reporter_name: '', phone: '', asset_id: 999 } });
      check('非法报修参数返回 400', badReq.status === 400 && badReq.data.error.code === 'VALIDATION_ERROR');
    }

    // ---------- 派工校验 ----------
    console.log('\n[3] 派工规则（技能/值班/在途）');
    {
      // 种子数据：WO-0003 CRITICAL EQUIPMENT_DAMAGE 待派工
      const offDuty = await api('POST', '/tickets/3/dispatch', { token: dispatcher, body: { crew_id: 4 } });
      check('非值班班组不可派（CREW_OFF_DUTY）', offDuty.status === 409 && offDuty.data.error.code === 'CREW_OFF_DUTY', offDuty.data);

      const mismatch = await api('POST', '/tickets/3/dispatch', { token: dispatcher, body: { crew_id: 1 } });
      check('技能不匹配不可派（CREW_SKILL_MISMATCH）', mismatch.status === 409 && mismatch.data.error.code === 'CREW_SKILL_MISMATCH');

      const busy = await api('POST', '/tickets/3/dispatch', { token: dispatcher, body: { crew_id: 1 } });
      check('一班有在途任务且技能不符，优先报技能或不匹配', busy.status === 409);

      // 一班技能不符，改用 WO-0002 所属类型验证在途：先给一班造一个匹配的在途单
      // WO-0002 是一班的 OUTAGE 在途单；新登记的城南一线 TRIP 单（ticketA）一班技能匹配
      const busy2 = await api('POST', `/tickets/${ticketA.id}/dispatch`, { token: dispatcher, body: { crew_id: 1 } });
      check('有在途任务的班组不可重复占用（CREW_BUSY）', busy2.status === 409 && busy2.data.error.code === 'CREW_BUSY', busy2.data);

      const ok = await api('POST', '/tickets/3/dispatch', { token: dispatcher, body: { crew_id: 2 } });
      check('派工成功（二班技能匹配且空闲）', ok.status === 200 && ok.data.status === 'ASSIGNED' && ok.data.crew_id === 2, ok.data);

      const again = await api('POST', '/tickets/3/dispatch', { token: dispatcher, body: { crew_id: 3 } });
      check('已派工工单不能重复派（TICKET_NOT_WAITING）', again.status === 409 && again.data.error.code === 'TICKET_NOT_WAITING');

      const avail = await api('GET', '/crews/available?fault_type=EQUIPMENT_DAMAGE', { token: dispatcher });
      const c2 = avail.data.find((c) => c.id === 2);
      const c4 = avail.data.find((c) => c.id === 4);
      check('可派性接口标注在途班组不可派', c2 && c2.eligible === false && /在途/.test(c2.reason), c2);
      check('可派性接口标注非值班班组不可派', c4 && c4.eligible === false && /值班/.test(c4.reason), c4);
    }

    // ---------- 班组推进与备件 ----------
    console.log('\n[4] 班组推进 + 备件领用');
    {
      const wrongLeader = await api('POST', '/tickets/3/advance', { token: leader1, body: { action: 'arrive' } });
      check('非本班组班组长不能推进（403）', wrongLeader.status === 403, wrongLeader.data);

      const wrongOrder = await api('POST', '/tickets/3/advance', { token: leader2, body: { action: 'restore' } });
      check('不能跳状态推进（TICKET_BAD_STATE）', wrongOrder.status === 409 && wrongOrder.data.error.code === 'TICKET_BAD_STATE');

      const arrive = await api('POST', '/tickets/3/advance', { token: leader2, body: { action: 'arrive' } });
      check('到场推进成功', arrive.status === 200 && arrive.data.ticket.status === 'ARRIVED');
      const repair = await api('POST', '/tickets/3/advance', { token: leader2, body: { action: 'start_repair' } });
      check('开始处理推进成功', repair.status === 200 && repair.data.ticket.status === 'REPAIRING');

      // 备件：熔断器（id=6）可用库存 0 → 超量拦截
      const over = await api('POST', '/tickets/3/parts', { token: leader2, body: { part_id: 6, quantity: 1 } });
      check('零库存备件申请被拦截（STOCK_INSUFFICIENT）', over.status === 409 && over.data.error.code === 'STOCK_INSUFFICIENT', over.data);

      // 柱上开关（id=3）可用 3，申请 5 → 超量
      const over2 = await api('POST', '/tickets/3/parts', { token: leader2, body: { part_id: 3, quantity: 5 } });
      check('申请量超可用库存被拦截', over2.status === 409 && over2.data.error.code === 'STOCK_INSUFFICIENT');

      const req1 = await api('POST', '/tickets/3/parts', { token: leader2, body: { part_id: 3, quantity: 2 } });
      check('备件申请成功（待审批）', req1.status === 201 && req1.data.status === 'REQUESTED', req1.data);
      usage1Id = req1.data.id;

      const req2 = await api('POST', '/tickets/3/parts', { token: leader2, body: { part_id: 5, quantity: 4 } });
      const usage2 = req2.data.id;

      // 审批前库存不变
      const before = await api('GET', '/parts', { token: keeper });
      check('待审批不占用库存', before.data.find((p) => p.id === 3).available_qty === 3);

      const rej = await api('POST', `/usages/${usage2}/reject`, { token: keeper, body: { reason: '规格不符' } });
      check('仓管驳回申请', rej.status === 200 && rej.data.status === 'REJECTED');

      const app = await api('POST', `/usages/${usage1Id}/approve`, { token: keeper, body: {} });
      check('仓管审批出库', app.status === 200 && app.data.status === 'APPROVED');
      const after = await api('GET', '/parts', { token: keeper });
      check('审批后库存同步扣减（3→1）', after.data.find((p) => p.id === 3).available_qty === 1);

      const dupApprove = await api('POST', `/usages/${usage1Id}/approve`, { token: keeper, body: {} });
      check('重复审批被拒绝（409）', dupApprove.status === 409);
    }

    // ---------- 改派释放 ----------
    console.log('\n[5] 改派：同事务释放、失败回滚与幂等');
    {
      // 在途工单 WO-0003（二班，REPAIRING）：已有已审批领用 usage1Id（柱上开关×2，库存 3→1），
      // 再补一笔待审批申请（绝缘子串×2）
      const reqP = await api('POST', '/tickets/3/parts', { token: leader2, body: { part_id: 5, quantity: 2 } });
      check('改派前补充待审批申请', reqP.status === 201 && reqP.data.status === 'REQUESTED', reqP.data);
      const pendingUsageId = reqP.data.id;

      // —— 幂等：请求的正是当前持有班组 → 返回当前成功状态，零副作用
      const sameCrew = await api('POST', '/tickets/3/reassign', { token: dispatcher, body: { crew_id: 2 } });
      check('请求当前持有班组返回当前成功状态（幂等）',
        sameCrew.status === 200 && sameCrew.data.crew_id === 2 && sameCrew.data.idempotent === true, sameCrew.data);

      // —— 失败回滚：改派给「其他」在途班组 → 409，库存/单据/事件零变化
      await api('POST', `/tickets/${ticketD}/dispatch`, { token: dispatcher, body: { crew_id: 3 } }); // 三班先占用 ticketD
      const releasedBefore = (await api('GET', '/audit-logs?action=PART_RELEASED&pageSize=100', { token: auditor })).data.total;
      const fail = await api('POST', '/tickets/3/reassign', { token: dispatcher, body: { crew_id: 3 } });
      check('改派给在途班组失败（CREW_BUSY）', fail.status === 409 && fail.data.error.code === 'CREW_BUSY', fail.data);
      const partsAfterFail = await api('GET', '/parts', { token: keeper });
      check('改派失败库存未动（柱上开关仍为 1）', partsAfterFail.data.find((p) => p.id === 3).available_qty === 1);
      const detailAfterFail = await api('GET', '/tickets/3', { token: dispatcher });
      check('改派失败已审批领用保持已领用',
        detailAfterFail.data.usages.find((u) => u.id === usage1Id).status === 'APPROVED');
      check('改派失败待审批申请保持待审批',
        detailAfterFail.data.usages.find((u) => u.id === pendingUsageId).status === 'REQUESTED');
      const releasedAfterFail = (await api('GET', '/audit-logs?action=PART_RELEASED&pageSize=100', { token: auditor })).data.total;
      check('改派失败未写入释放事件', releasedAfterFail === releasedBefore, `${releasedBefore}→${releasedAfterFail}`);
      // 恢复：ticketD 撤回待派工，三班释放（不影响后续补派测试）
      await api('POST', `/tickets/${ticketD}/reassign`, { token: dispatcher, body: {} });

      // —— 成功改派：待审批释放 + 已审批回库 + 事件记录，同一事务完成
      const re = await api('POST', '/tickets/3/reassign', { token: dispatcher, body: { crew_id: 3 } });
      check('改派到三班成功', re.status === 200 && re.data.crew_id === 3 && re.data.status === 'ASSIGNED', re.data);
      const partsNow = await api('GET', '/parts', { token: keeper });
      check('已审批备件同步回库（1→3）', partsNow.data.find((p) => p.id === 3).available_qty === 3);
      check('待审批释放不动库存（绝缘子串仍为 45）', partsNow.data.find((p) => p.id === 5).available_qty === 45);
      const detail2 = await api('GET', '/tickets/3', { token: dispatcher });
      check('已审批领用已释放', detail2.data.usages.find((u) => u.id === usage1Id).status === 'RELEASED');
      check('待审批申请已释放', detail2.data.usages.find((u) => u.id === pendingUsageId).status === 'RELEASED');

      // —— 每条释放都有可追溯事件：原申请人、备件数量、前后状态、关联工单
      const relLogs = (await api('GET', '/audit-logs?action=PART_RELEASED&pageSize=100', { token: auditor })).data.rows
        .filter((l) => l.detail.includes('WO-0003'));
      check('释放事件逐条记录（2 条）', relLogs.length === 2, relLogs.map((l) => l.detail));
      const evApproved = relLogs.find((l) => l.detail.includes('柱上开关'));
      const evPending = relLogs.find((l) => l.detail.includes('绝缘子串'));
      check('释放事件含前后状态/原申请人/数量/工单（已审批）',
        !!evApproved && evApproved.detail.includes('已领用 → 已释放')
          && evApproved.detail.includes('李建国') && evApproved.detail.includes('× 2')
          && evApproved.detail.includes('WO-0003'),
        evApproved && evApproved.detail);
      check('释放事件含前后状态/数量/工单（待审批）',
        !!evPending && evPending.detail.includes('待审批 → 已释放')
          && evPending.detail.includes('× 2') && evPending.detail.includes('WO-0003'),
        evPending && evPending.detail);
      const stockLogs = await api('GET', '/stock-logs?part_id=3', { token: keeper });
      check('回库流水关联工单号', stockLogs.data.some((l) => l.change_qty === 2 && l.reason.includes('WO-0003')));

      // —— 重复改派（撤回）不重复释放、不重复记录
      const back = await api('POST', '/tickets/3/reassign', { token: dispatcher, body: {} });
      check('撤回工单回待派工队列', back.status === 200 && back.data.status === 'WAIT_DISPATCH' && back.data.crew_id === null);
      const relLogs2 = (await api('GET', '/audit-logs?action=PART_RELEASED&pageSize=100', { token: auditor })).data.rows
        .filter((l) => l.detail.includes('WO-0003'));
      check('重复改派不重复记录释放事件', relLogs2.length === 2, relLogs2.length);
      const partsFinal = await api('GET', '/parts', { token: keeper });
      check('重复改派库存不重复回补（仍为 3）', partsFinal.data.find((p) => p.id === 3).available_qty === 3);
    }

    // ---------- 改派/撤回重试幂等与并发 ----------
    console.log('\n[5b] 改派/撤回重试幂等、并发与状态定义统一');
    {
      const countReleased = async () =>
        (await api('GET', '/audit-logs?action=PART_RELEASED&pageSize=100', { token: auditor })).data.rows
          .filter((l) => l.detail.includes('WO-0003')).length;
      const stockOf = async (id) =>
        (await api('GET', '/parts', { token: keeper })).data.find((p) => p.id === id).available_qty;
      const stockLogsOf = async (id) =>
        (await api('GET', `/stock-logs?part_id=${id}`, { token: keeper })).data.length;

      // 重新派工给二班，构造 已审批（柱上开关×1）+ 待审批（绝缘子串×1）各一笔
      await api('POST', '/tickets/3/dispatch', { token: dispatcher, body: { crew_id: 2 } });
      const rA = await api('POST', '/tickets/3/parts', { token: leader2, body: { part_id: 3, quantity: 1 } });
      await api('POST', `/usages/${rA.data.id}/approve`, { token: keeper }); // 柱上开关 3→2
      await api('POST', '/tickets/3/parts', { token: leader2, body: { part_id: 5, quantity: 1 } });

      // —— 两个相同请求同时到达：只释放一次
      const [c1, c2] = await Promise.all([
        api('POST', '/tickets/3/reassign', { token: dispatcher, body: { crew_id: 3 } }),
        api('POST', '/tickets/3/reassign', { token: dispatcher, body: { crew_id: 3 } }),
      ]);
      check('并发相同改派均返回成功', c1.status === 200 && c2.status === 200, `${c1.status},${c2.status}`);
      check('并发改派后工单归属一致', c1.data.crew_id === 3 && c2.data.crew_id === 3);
      check('并发请求只释放一次（事件累计 4 条）', await countReleased() === 4, await countReleased());
      check('并发请求只回库一次（柱上开关 2→3）', await stockOf(3) === 3, await stockOf(3));

      // —— 再次请求同一目标班组：返回当前成功状态，零副作用
      const snap = { events: await countReleased(), stock: await stockOf(3), logs: await stockLogsOf(3) };
      const retry = await api('POST', '/tickets/3/reassign', { token: dispatcher, body: { crew_id: 3 } });
      check('同一目标重试返回当前成功状态',
        retry.status === 200 && retry.data.crew_id === 3 && retry.data.status === 'ASSIGNED', retry.data);
      check('同一目标重试标记幂等', retry.data.idempotent === true, retry.data);
      check('重试不重复记录释放事件', await countReleased() === snap.events);
      check('重试不重复回库', await stockOf(3) === snap.stock);
      check('重试不重复写库存流水', await stockLogsOf(3) === snap.logs);

      // —— 撤回后再次撤回：幂等返回，零副作用
      const un1 = await api('POST', '/tickets/3/reassign', { token: dispatcher, body: {} });
      check('撤回成功', un1.status === 200 && un1.data.status === 'WAIT_DISPATCH' && !un1.data.idempotent);
      const un2 = await api('POST', '/tickets/3/reassign', { token: dispatcher, body: {} });
      check('再次撤回返回当前成功状态',
        un2.status === 200 && un2.data.status === 'WAIT_DISPATCH' && un2.data.idempotent === true, un2.data);
      check('再次撤回零副作用',
        await countReleased() === snap.events && await stockOf(3) === snap.stock && await stockLogsOf(3) === snap.logs);

      // —— 换到不同目标且工单仍在途：正常改派，只释放一次
      await api('POST', '/tickets/3/dispatch', { token: dispatcher, body: { crew_id: 2 } });
      const rC = await api('POST', '/tickets/3/parts', { token: leader2, body: { part_id: 3, quantity: 1 } });
      await api('POST', `/usages/${rC.data.id}/approve`, { token: keeper }); // 柱上开关 3→2
      const diff = await api('POST', '/tickets/3/reassign', { token: dispatcher, body: { crew_id: 3 } });
      check('在途工单改派到不同班组成功', diff.status === 200 && diff.data.crew_id === 3 && !diff.data.idempotent);
      check('不同目标改派只回库一次（2→3）', await stockOf(3) === 3, await stockOf(3));
      check('不同目标改派只新增一条释放事件', await countReleased() === snap.events + 1, await countReleased());

      // —— 无效目标：工单、库存、领用、审计全部回到请求前状态
      const badCrew = await api('POST', '/tickets/3/reassign', { token: dispatcher, body: { crew_id: 999 } });
      check('不存在的班组返回 404', badCrew.status === 404 && badCrew.data.error.code === 'NOT_FOUND', badCrew.data);
      const rD = await api('POST', '/tickets/3/parts', { token: leader3, body: { part_id: 1, quantity: 1 } });
      await api('POST', `/usages/${rD.data.id}/approve`, { token: keeper }); // 避雷器 10→9
      const preInvalid = { events: await countReleased(), stock1: await stockOf(1), stock3: await stockOf(3) };
      const badDuty = await api('POST', '/tickets/3/reassign', { token: dispatcher, body: { crew_id: 4 } });
      check('未值班班组改派被拒绝（CREW_OFF_DUTY）', badDuty.status === 409 && badDuty.data.error.code === 'CREW_OFF_DUTY');
      const t3Invalid = await api('GET', '/tickets/3', { token: dispatcher });
      check('无效目标后工单仍属原班组且在途',
        t3Invalid.data.ticket.crew_id === 3 && t3Invalid.data.ticket.status === 'ASSIGNED', t3Invalid.data.ticket);
      check('无效目标后领用保持已领用',
        t3Invalid.data.usages.find((u) => u.id === rD.data.id).status === 'APPROVED');
      check('无效目标后库存不变',
        await stockOf(1) === preInvalid.stock1 && await stockOf(3) === preInvalid.stock3);
      check('无效目标后无新释放事件', await countReleased() === preInvalid.events);

      // 收尾：退回领用并撤回工单，恢复 WO-0003 待派工（供后续补派测试）
      await api('POST', `/usages/${rD.data.id}/return`, { token: leader3 }); // 避雷器 9→10
      const cleanup = await api('POST', '/tickets/3/reassign', { token: dispatcher, body: {} });
      check('收尾恢复待派工', cleanup.status === 200 && cleanup.data.status === 'WAIT_DISPATCH');

      // —— 源码守卫：状态判断统一引用共享常量，查询里不写状态集合字面量
      const svcDir = path.join(__dirname, '..', 'src', 'services');
      const literalHits = [];
      for (const f of fs.readdirSync(svcDir)) {
        const src = fs.readFileSync(path.join(svcDir, f), 'utf8');
        const hits = src.match(/status\s+IN\s*\(\s*'[A-Z_]+'/g);
        if (hits) literalHits.push(`${f}: ${hits.join(',')}`);
      }
      check('服务层查询不含状态集合字面量', literalHits.length === 0, literalHits.join(' | '));
      const faultSrc = fs.readFileSync(path.join(svcDir, 'faultService.js'), 'utf8');
      check('吸收报修引用共享状态定义 ABSORBING_TICKET_STATUS',
        faultSrc.includes('ABSORBING_TICKET_STATUS_SQL'));
    }

    // ---------- 复电补派 ----------
    console.log('\n[6] 复电后按等级与等待时长补派');
    {
      // 当前待派工：WO-0003(CRITICAL,最早)、ticketA(CRITICAL)、ticketD(MAJOR)、WO-0004(MINOR)
      // 空闲值班班组：一班(OUTAGE/TRIP)、二班(EQUIPMENT_DAMAGE/SAFETY_RISK)、三班(全能)
      // 一班复电后补派：一班→ticketA(TRIP)，二班→WO-0003，三班→ticketD(MAJOR 优先于 WO-0004 MINOR)
      const restore = await api('POST', '/tickets/2/advance', { token: leader1, body: { action: 'restore' } });
      check('一班复电成功', restore.status === 200 && restore.data.ticket.status === 'RESTORED', restore.data);
      check('复电触发补派', Array.isArray(restore.data.backfilled) && restore.data.backfilled.length >= 1, restore.data.backfilled);

      const tA = await api('GET', `/tickets/${ticketA.id}`, { token: dispatcher });
      check('同类型排队工单被自动补派给一班', tA.data.ticket.status === 'ASSIGNED' && tA.data.ticket.crew_id === 1, tA.data.ticket);

      const t3 = await api('GET', '/tickets/3', { token: dispatcher });
      check('最高等级 WO-0003 被补派（AUTO_BACKFILL）',
        t3.data.ticket.status === 'ASSIGNED' && t3.data.ticket.dispatch_mode === 'AUTO_BACKFILL', t3.data.ticket);

      const tD = await api('GET', `/tickets/${ticketD}`, { token: dispatcher });
      check('次高等级 ticketD 补派给三班', tD.data.ticket.status === 'ASSIGNED' && tD.data.ticket.crew_id === 3, tD.data.ticket);

      const t4 = await api('GET', '/tickets/4', { token: dispatcher });
      check('最低等级 WO-0004 因匹配班组均已占用而继续排队', t4.data.ticket.status === 'WAIT_DISPATCH', t4.data.ticket);

      // 一班已有在途（ticketA），不能再被占用
      const crews = await api('GET', '/crews', { token: dispatcher });
      const c1 = crews.data.find((c) => c.id === 1);
      check('一班被新工单占用，不重复派单', c1.active_ticket && c1.active_ticket.id === ticketA.id, c1);
    }

    // ---------- 退回 / 核销 / 关闭 ----------
    console.log('\n[7] 备件退回核销与工单关闭');
    {
      // ticketA 现为一班在途（ASSIGNED）。一班推进至处理中
      await api('POST', `/tickets/${ticketA.id}/advance`, { token: leader1, body: { action: 'arrive' } });
      await api('POST', `/tickets/${ticketA.id}/advance`, { token: leader1, body: { action: 'start_repair' } });

      // 在处理中领用两笔备件并审批出库
      const reqA = await api('POST', `/tickets/${ticketA.id}/parts`, { token: leader1, body: { part_id: 1, quantity: 3 } });
      const usageA = reqA.data.id;
      await api('POST', `/usages/${usageA}/approve`, { token: keeper, body: {} });
      const reqB = await api('POST', `/tickets/${ticketA.id}/parts`, { token: leader1, body: { part_id: 1, quantity: 2 } });
      const usageB = reqB.data.id;
      await api('POST', `/usages/${usageB}/approve`, { token: keeper, body: {} });
      const p1 = await api('GET', '/parts', { token: keeper });
      check('两笔领用后避雷器库存 10→5', p1.data.find((p) => p.id === 1).available_qty === 5, p1.data.find((p) => p.id === 1));

      // 复电后工单释放班组，备件申请通道关闭
      await api('POST', `/tickets/${ticketA.id}/advance`, { token: leader1, body: { action: 'restore' } });
      const lateReq = await api('POST', `/tickets/${ticketA.id}/parts`, { token: leader1, body: { part_id: 1, quantity: 1 } });
      check('复电后不可再申请备件（409）', lateReq.status === 409 && lateReq.data.error.code === 'TICKET_BAD_STATE');

      // —— 边界：已复电工单不再吸收同线路同类型新报修，新报修生成独立待派工单
      const rWhileRestored = await api('POST', '/faults', {
        token: dispatcher,
        body: { reporter_name: '测试己', phone: '13000000006', asset_id: 6, fault_type: 'TRIP', severity: 'MAJOR', address_desc: '城南一线复电后再跳闸', report_channel: '热线' },
      });
      check('已复电工单不吸收新报修，生成独立待派工单',
        rWhileRestored.data.merged === false
          && rWhileRestored.data.ticket.id !== ticketA.id
          && rWhileRestored.data.ticket.status === 'WAIT_DISPATCH',
        rWhileRestored.data);
      const ticketE = rWhileRestored.data.ticket.id;
      const detailRestored = await api('GET', `/tickets/${ticketA.id}`, { token: dispatcher });
      check('原工单报修归属不变（仍 3 条）', detailRestored.data.reports.length === 3, detailRestored.data.reports.length);
      check('原工单处理历史不变（已复电且在途时间线完整）',
        detailRestored.data.ticket.status === 'RESTORED'
          && !!detailRestored.data.ticket.restored_at
          && !!detailRestored.data.ticket.arrived_at);

      // 关闭被未完结领用阻塞
      const blocked = await api('POST', `/tickets/${ticketA.id}/advance`, { token: leader1, body: { action: 'close' } });
      check('存在未完结领用时禁止关闭', blocked.status === 409 && blocked.data.error.code === 'TICKET_BAD_STATE', blocked.data);

      // 退回第一笔 → 库存回补
      const ret = await api('POST', `/usages/${usageA}/return`, { token: leader1, body: {} });
      check('班组长退回备件', ret.status === 200 && ret.data.status === 'RETURNED');
      const p1b = await api('GET', '/parts', { token: keeper });
      check('退回后库存回补 5→8', p1b.data.find((p) => p.id === 1).available_qty === 8);

      // 核销第二笔（消耗不退库存）
      const con = await api('POST', `/usages/${usageB}/consume`, { token: leader1, body: {} });
      check('核销消耗成功', con.status === 200 && con.data.status === 'CONSUMED', con.data);
      const p1c = await api('GET', '/parts', { token: keeper });
      check('核销不回补库存（仍为 8）', p1c.data.find((p) => p.id === 1).available_qty === 8);

      const closed = await api('POST', `/tickets/${ticketA.id}/advance`, { token: leader1, body: { action: 'close' } });
      check('工单关闭成功', closed.status === 200 && closed.data.ticket.status === 'CLOSED');

      const detail = await api('GET', `/tickets/${ticketA.id}`, { token: dispatcher });
      check('关闭后关联报修单全部闭环', detail.data.reports.every((r) => r.status === 'CLOSED'));

      // 已闭环工单同样不吸收；同线路同类型新报修合并进上一步生成的独立待派工单
      const rNew = await api('POST', '/faults', {
        token: dispatcher,
        body: { reporter_name: '测试戊', phone: '13000000005', asset_id: 6, fault_type: 'TRIP', severity: 'MINOR', address_desc: '城南一线再次跳闸', report_channel: '热线' },
      });
      check('已闭环工单不吸收，新报修合并进独立待派工单',
        rNew.data.merged === true && rNew.data.ticket.id === ticketE && rNew.data.ticket.id !== ticketA.id,
        rNew.data);
    }

    // ---------- 审计与库存流水 ----------
    console.log('\n[8] 审计追溯');
    {
      const logs = await api('GET', '/audit-logs?page=1&pageSize=100', { token: auditor });
      check('审计员可查询日志', logs.status === 200 && logs.data.total > 0);
      const actions = new Set(logs.data.rows.map((r) => r.action));
      check('关键动作均有审计记录',
        ['FAULT_REGISTERED', 'FAULT_MERGED', 'TICKET_CREATED', 'TICKET_DISPATCHED', 'TICKET_AUTO_DISPATCHED',
         'TICKET_ADVANCED', 'PART_APPROVED', 'PART_RETURNED', 'TICKET_REASSIGNED', 'TICKET_CLOSED']
          .every((a) => actions.has(a)), [...actions]);

      const ticketLogs = await api('GET', `/audit-logs?entityType=TICKET&entityId=${ticketA.id}`, { token: auditor });
      check('可按工单追溯全部变更', ticketLogs.data.rows.length >= 5, ticketLogs.data.rows.length);

      const stock = await api('GET', '/stock-logs?part_id=1', { token: auditor });
      check('库存流水含出库与退回入库', stock.data.some((l) => l.change_qty < 0) && stock.data.some((l) => l.change_qty > 0));
    }

    // ---------- 持久化：重启后状态一致 ----------
    console.log('\n[9] 落盘持久化（模拟刷新/重启）');
    {
      check('数据库文件已落盘', fs.existsSync(DB_FILE));
      const before = await api('GET', '/tickets', { token: dispatcher });
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 400));
      const child2 = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'main.js')], {
        env: { ...process.env, PORT: String(PORT), GRID_REPAIR_DB_FILE: DB_FILE },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child2.stderr.on('data', (d) => process.stderr.write(`[server2] ${d}`));
      await waitForServer(child2);
      const token2 = await login('dispatcher01');
      const after = await api('GET', '/tickets', { token: token2 });
      check('重启后工单状态与重启前一致',
        JSON.stringify(before.data.map((t) => [t.id, t.status, t.crew_id])) ===
        JSON.stringify(after.data.map((t) => [t.id, t.status, t.crew_id])));
      const partsAfter = await api('GET', '/parts', { token: token2 });
      check('重启后库存一致（避雷器可用 8）', partsAfter.data.find((p) => p.id === 1).available_qty === 8);
      child2.kill('SIGTERM');
    }
  } finally {
    child.kill('SIGTERM');
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  if (failed) {
    console.log('失败项:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
