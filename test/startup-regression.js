'use strict';

/**
 * 启动链路回归测试（全新检出 → 一条命令启动 → 页面与接口同时可用）。
 *
 * 场景：
 *   阶段 1  干净目录（无依赖/无 dist/无数据）按根 README 首选步骤
 *           `npm install && npm start`，启动时自动补齐前端构建产物，
 *           统一入口下页面与接口同时可用；
 *   阶段 2  前端资源补齐失败（构建错误）：进程终止、退出码非零、错误清晰，
 *           不会留下"只有健康检查"的半截服务；
 *   阶段 3  旧构建产物落后于源码：启动时自动重建，旧资源不掩盖当前源码；
 *   阶段 4  重复启动：已有业务数据不受影响。
 *
 * 测试在临时目录内复制项目副本执行，不修改仓库业务实现，不触碰工作区的
 * node_modules / dist / data；结束后自动清理，可连续重复运行。
 *
 * 运行：node test/startup-regression.js
 * 退出码：0 = 全部通过；1 = 存在失败（输出标明阶段与原因）。
 */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 29511; // 独立端口，避开演示环境 21104 与 e2e 29904
const BASE = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];
let currentStage = '';

function stage(title) {
  currentStage = title;
  console.log(`\n[阶段] ${title}`);
}

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`[${currentStage}] ${name}`);
    console.log(`  ✗ ${name}${extra !== undefined ? ' → ' + String(extra).slice(0, 300) : ''}`);
  }
}

function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    timeout: 600000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function copyDir(src, dst, exclude) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d, exclude);
    else fs.copyFileSync(s, d);
  }
}

/** 准备"全新检出"副本：只含源码与清单，不含依赖/构建产物/运行数据 */
function prepareCheckout(workDir) {
  copyDir(path.join(ROOT, 'backend'), path.join(workDir, 'backend'),
    new Set(['node_modules', 'data', 'test', 'Dockerfile']));
  copyDir(path.join(ROOT, 'frontend'), path.join(workDir, 'frontend'),
    new Set(['node_modules', 'dist', 'Dockerfile', 'vite.test.config.js']));
}

const children = [];
/** 以根 README 首选命令 npm start 启动副本服务 */
function startBackend(workDir) {
  const child = spawn('npm', ['start'], {
    cwd: path.join(workDir, 'backend'),
    env: {
      ...process.env,
      PORT: String(PORT),
      GRID_REPAIR_DB_FILE: path.join(workDir, 'backend', 'data', 'runtime.sqlite'),
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.log = '';
  child.stdout.on('data', (d) => { child.log += d; });
  child.stderr.on('data', (d) => { child.log += d; });
  children.push(child);
  return child;
}

function stopBackend(child) {
  if (!child || child.killed) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* 已退出 */ }
  setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 已退出 */ }
  }, 1500).unref();
}

function waitExit(child, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function waitUp(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function waitDown(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(`${BASE}/health`);
      await new Promise((r) => setTimeout(r, 300));
    } catch {
      return true;
    }
  }
  return false;
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
  try { data = await res.json(); } catch { /* 非 JSON */ }
  return { status: res.status, data, headers: res.headers };
}

async function getText(url) {
  const res = await fetch(BASE + url);
  return { status: res.status, text: await res.text(), contentType: res.headers.get('content-type') || '' };
}

async function login(username) {
  const r = await api('POST', '/api/auth/login', { body: { username, password: '123456' } });
  return r.status === 200 ? r.data.token : null;
}

/** 统一入口验证：页面与接口同时可用（不只看健康检查） */
async function verifySiteAndApi(token2) {
  const home = await getText('/');
  check('GET / 返回页面（200 HTML）', home.status === 200 && home.contentType.includes('text/html'),
    `${home.status} ${home.contentType}`);
  check('页面包含应用挂载点', home.text.includes('id="app"'));
  const assetMatch = home.text.match(/src="(\/assets\/[^"]+\.js)"/);
  check('页面引用构建产物资源', !!assetMatch, home.text.slice(0, 200));
  if (assetMatch) {
    const asset = await getText(assetMatch[1]);
    check('主 JS 资源可加载', asset.status === 200, asset.status);
  }
  const spaRoute = await getText('/tickets');
  check('SPA 路由回退可用（/tickets 返回应用页）',
    spaRoute.status === 200 && spaRoute.text.includes('id="app"'), spaRoute.status);

  const token = token2 || await login('dispatcher01');
  check('调度员登录成功', !!token);
  if (token) {
    const dash = await api('GET', '/api/dashboard', { token });
    check('态势接口可用', dash.status === 200 && typeof dash.data.waitDispatch === 'number');
    const tickets = await api('GET', '/api/tickets', { token });
    check('工单接口可用（有数据）', tickets.status === 200 && Array.isArray(tickets.data) && tickets.data.length > 0);
    const crews = await api('GET', '/api/crews', { token });
    check('班组接口可用', crews.status === 200 && crews.data.length === 4);
    const parts = await api('GET', '/api/parts', { token });
    check('备件接口可用', parts.status === 200 && parts.data.length === 6);
  }
  const noAuth = await api('GET', '/api/tickets');
  check('未登录接口访问被拒（401）', noAuth.status === 401);
  return token;
}

async function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-startup-'));
  console.log(`临时检出目录: ${workDir}`);
  const frontendDir = path.join(workDir, 'frontend');
  const backendDir = path.join(workDir, 'backend');
  const distDir = path.join(frontendDir, 'dist');

  try {
    // ============================== 阶段 1 ==============================
    stage('1 干净目录：首选命令启动，页面与接口同时可用');
    prepareCheckout(workDir);
    check('副本不含前端构建产物', !fs.existsSync(distDir));
    check('副本不含运行数据', !fs.existsSync(path.join(backendDir, 'data')));
    check('副本不含依赖目录', !fs.existsSync(path.join(backendDir, 'node_modules'))
      && !fs.existsSync(path.join(frontendDir, 'node_modules')));

    // 根 README 首选步骤：cd backend && npm install && npm start
    const installBackend = run('npm', ['install'], backendDir);
    check('后端 npm install 成功', installBackend.code === 0, installBackend.stderr.slice(-300));

    const srv1 = startBackend(workDir);
    check('首选命令启动成功（启动中自动补齐前端产物，超时容忍首次安装）',
      await waitUp(300000), srv1.log.slice(-400));
    check('启动日志记录自动补齐过程', /自动补齐|构建产物已就绪/.test(srv1.log),
      srv1.log.slice(-300));
    check('前端构建产物已自动生成', fs.existsSync(path.join(distDir, 'index.html')));
    await verifySiteAndApi();
    check('运行数据已落盘（真实数据链路）',
      fs.existsSync(path.join(backendDir, 'data', 'runtime.sqlite')));
    stopBackend(srv1);
    check('服务可正常停止', await waitDown());

    // ============================== 阶段 2 ==============================
    stage('2 前端资源补齐失败：进程终止、错误清晰、不留半截服务');
    const mainJs = path.join(frontendDir, 'src', 'main.js');
    const mainJsBak = fs.readFileSync(mainJs, 'utf8');
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.writeFileSync(mainJs, 'import { broken from nowhere;\n'); // 仅破坏临时副本
    const srv2 = startBackend(workDir);
    const exitCode = await waitExit(srv2, 180000);
    check('补齐失败时进程退出且退出码非零', exitCode !== null && exitCode !== 0, `exit=${exitCode}`);
    check('错误输出清晰（含构建失败与服务终止）',
      /前端构建失败/.test(srv2.log) && /服务终止/.test(srv2.log), srv2.log.slice(-300));
    let healthUp = false;
    try {
      await fetch(`${BASE}/health`);
      healthUp = true;
    } catch { /* 预期不可达 */ }
    check('服务未启动，健康检查不可达（不会出现只有健康的半截服务）', !healthUp);
    fs.writeFileSync(mainJs, mainJsBak); // 恢复副本源码

    // ============================== 阶段 3 ==============================
    stage('3 旧构建产物：落后于源码时自动重建，旧资源不掩盖当前源码');
    // 伪造一份"旧"构建产物（mtime 回拨到 2 小时前）
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'),
      '<!DOCTYPE html><html><head><title>stale</title></head>'
      + '<body>STALE_BUILD_MARKER<script src="/assets/stale-legacy.js"></script></body></html>');
    fs.writeFileSync(path.join(distDir, 'assets', 'stale-legacy.js'), '/* stale build */');
    const past = new Date(Date.now() - 2 * 3600 * 1000);
    fs.utimesSync(path.join(distDir, 'index.html'), past, past);
    fs.utimesSync(path.join(distDir, 'assets', 'stale-legacy.js'), past, past);
    // 源码保持当前时间（明显新于旧产物）
    fs.appendFileSync(mainJs, '\n// touched by startup-regression to mark source newer than dist\n');
    const srv3 = startBackend(workDir);
    check('旧产物下启动成功（自动重建）', await waitUp(300000), srv3.log.slice(-400));
    check('启动日志记录产物过期与补齐', /已落后|自动补齐|已就绪/.test(srv3.log), srv3.log.slice(-300));
    const home3 = await getText('/');
    check('GET / 不含旧构建标记', home3.status === 200 && !home3.text.includes('STALE_BUILD_MARKER'));
    check('页面为当前源码构建的应用', home3.text.includes('id="app"'));
    const staleAsset = await getText('/assets/stale-legacy.js');
    check('旧产物资源不再返回旧内容', !staleAsset.text.includes('stale build'), `status=${staleAsset.status}`);
    fs.writeFileSync(mainJs, mainJsBak); // 恢复副本源码（去掉追加的注释）
    stopBackend(srv3);
    check('服务停止', await waitDown());

    // ============================== 阶段 4 ==============================
    stage('4 重复启动：已有业务数据不受影响');
    const srv4 = startBackend(workDir);
    check('第一次启动', await waitUp(120000), srv4.log.slice(-300));
    const token4 = await login('dispatcher01');
    const before = await api('GET', '/api/tickets', { token: token4 });
    const created = await api('POST', '/api/faults', {
      token: token4,
      body: { reporter_name: '回归验证', phone: '13100001111', asset_id: 1, fault_type: 'OUTAGE', severity: 'MAJOR', address_desc: '重复启动数据验证', report_channel: '热线' },
    });
    check('登记报修生成新工单', created.status === 201, created.data);
    const newTicketNo = created.data && created.data.ticket && created.data.ticket.ticket_no;
    stopBackend(srv4);
    await waitDown();

    const srv4b = startBackend(workDir);
    check('第二次启动（同一命令）', await waitUp(120000), srv4b.log.slice(-300));
    const token4b = await login('dispatcher01');
    const after = await api('GET', '/api/tickets', { token: token4b });
    check('重复启动后工单总数未丢失',
      after.status === 200 && after.data.length === before.data.length + 1,
      `${before.data.length}+1 vs ${after.data && after.data.length}`);
    check('新登记的工单仍然存在',
      after.data.some((t) => t.ticket_no === newTicketNo), newTicketNo);
    const users = await api('GET', '/api/crews', { token: token4b });
    check('种子数据未被重复写入（班组仍为 4 个）', users.data.length === 4);
    stopBackend(srv4b);
    check('服务停止', await waitDown());
  } finally {
    for (const child of children) stopBackend(child);
    await new Promise((r) => setTimeout(r, 600));
    fs.rmSync(workDir, { recursive: true, force: true });
    console.log(`\n临时目录已清理: ${workDir}`);
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  if (failed) {
    console.log('失败项:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  for (const child of children) stopBackend(child);
  process.exit(130);
});

main().catch((err) => {
  console.error(`\n[阶段] ${currentStage} 执行异常:`, err);
  process.exit(1);
});
