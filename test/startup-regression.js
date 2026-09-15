'use strict';

/**
 * 启动链路回归测试（全新检出 → 安装 → 构建 → 启动 → 统一入口验证）。
 *
 * 场景：
 *   阶段 1  干净目录（无 frontend/dist、无运行数据）按根 README 安装依赖并启动，
 *           通过统一入口确认关键页面与接口可用；
 *   阶段 2  无构建产物时：后端 /health 健康但页面 404 —— 健康检查不代表整站可用；
 *   阶段 3  旧构建产物：托管内容随真实重新构建而更新（无需重启后端）；
 *   阶段 4  真实构建失败：退出码非零、错误输出清楚，且环境可自恢复。
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

/** 运行命令并返回结果（同步，用于安装与构建） */
function run(cmd, args, cwd) {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
    timeout: 600000,
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

/** 递归复制目录，按名称排除 */
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
/** 以后端 npm start 启动副本服务（与根 README 的启动命令一致） */
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

async function waitUp(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return true;
    } catch { /* 未就绪 */ }
    await new Promise((r) => setTimeout(r, 400));
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

async function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-startup-'));
  console.log(`临时检出目录: ${workDir}`);
  const frontendDir = path.join(workDir, 'frontend');
  const backendDir = path.join(workDir, 'backend');
  const distDir = path.join(frontendDir, 'dist');

  try {
    // ============================== 阶段 1 ==============================
    stage('1 干净目录：安装依赖 → 构建 → 启动 → 统一入口验证');
    prepareCheckout(workDir);
    check('副本不含前端构建产物', !fs.existsSync(distDir));
    check('副本不含运行数据', !fs.existsSync(path.join(backendDir, 'data')));
    check('副本不含依赖目录', !fs.existsSync(path.join(backendDir, 'node_modules'))
      && !fs.existsSync(path.join(frontendDir, 'node_modules')));

    // 按根 README：backend && npm install
    const installBackend = run('npm', ['install'], backendDir);
    check('后端 npm install 成功', installBackend.code === 0,
      installBackend.stderr.slice(-300));
    // 按根 README：frontend && npm install
    const installFrontend = run('npm', ['install'], frontendDir);
    check('前端 npm install 成功', installFrontend.code === 0,
      installFrontend.stderr.slice(-300));
    // 按根 README：frontend npm run build
    const build1 = run('npm', ['run', 'build'], frontendDir);
    check('前端 npm run build 成功', build1.code === 0, (build1.stderr || build1.stdout).slice(-300));
    check('构建产物 dist 已生成', fs.existsSync(path.join(distDir, 'index.html')));

    // 按根 README：backend npm start
    const srv1 = startBackend(workDir);
    check('后端启动且健康检查通过', await waitUp(), srv1.log.slice(-300));

    // —— 统一入口：关键页面可用（不只看 /health）——
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
    const cssMatch = home.text.match(/href="(\/assets\/[^"]+\.css)"/);
    if (cssMatch) {
      const css = await getText(cssMatch[1]);
      check('主 CSS 资源可加载', css.status === 200, css.status);
    }
    const spaRoute = await getText('/tickets');
    check('SPA 路由回退可用（/tickets 返回应用页）',
      spaRoute.status === 200 && spaRoute.text.includes('id="app"'), spaRoute.status);

    // —— 统一入口：关键接口可用 ——
    const badLogin = await api('POST', '/api/auth/login', { body: { username: 'dispatcher01', password: 'wrong' } });
    check('错误口令被拒绝（401）', badLogin.status === 401);
    const token = await login('dispatcher01');
    check('调度员登录成功', !!token);
    const auditorToken = await login('auditor01');
    check('审计员登录成功', !!auditorToken);
    if (token) {
      const dash = await api('GET', '/api/dashboard', { token });
      check('态势接口可用', dash.status === 200 && typeof dash.data.waitDispatch === 'number');
      const tickets = await api('GET', '/api/tickets', { token });
      check('工单接口可用（有种子数据）', tickets.status === 200 && Array.isArray(tickets.data) && tickets.data.length > 0);
      const crews = await api('GET', '/api/crews', { token });
      check('班组接口可用', crews.status === 200 && crews.data.length === 4);
      const parts = await api('GET', '/api/parts', { token });
      check('备件接口可用', parts.status === 200 && parts.data.length === 6);
      const faults = await api('GET', '/api/faults', { token });
      check('报修接口可用', faults.status === 200 && Array.isArray(faults.data));
      const assets = await api('GET', '/api/assets', { token });
      check('资产接口可用', assets.status === 200 && assets.data.length === 8);
    }
    if (auditorToken) {
      const logs = await api('GET', '/api/audit-logs', { token: auditorToken });
      check('审计接口可用', logs.status === 200 && logs.data.total >= 0);
    }
    const noAuth = await api('GET', '/api/tickets');
    check('未登录接口访问被拒（401）', noAuth.status === 401);
    check('运行数据已落盘（真实数据链路）',
      fs.existsSync(path.join(backendDir, 'data', 'runtime.sqlite')));
    stopBackend(srv1);
    check('服务可正常停止', await waitDown());

    // ============================== 阶段 2 ==============================
    stage('2 无构建产物：后端健康 ≠ 整站可用');
    fs.rmSync(distDir, { recursive: true, force: true });
    check('已移除构建产物', !fs.existsSync(distDir));
    const srv2 = startBackend(workDir);
    check('后端健康检查通过', await waitUp(), srv2.log.slice(-300));
    const noPage = await getText('/');
    check('但 GET / 不可用（非 200）——健康不代表整站可用', noPage.status !== 200, noPage.status);
    const noAsset = await getText('/assets/anything.js');
    check('静态资源同样不可用', noAsset.status !== 200, noAsset.status);
    const apiStill = await api('POST', '/api/auth/login', { body: { username: 'dispatcher01', password: '123456' } });
    check('此时接口仍正常（进一步说明健康/接口不代表页面可用）', apiStill.status === 200);
    stopBackend(srv2);
    await waitDown();
    // 构建后重启，整站恢复（dist 在启动时不存在则不会托管，需重启生效）
    const build2 = run('npm', ['run', 'build'], frontendDir);
    check('重新构建成功', build2.code === 0, (build2.stderr || build2.stdout).slice(-300));
    const srv2b = startBackend(workDir);
    check('重启后健康检查通过', await waitUp(), srv2b.log.slice(-300));
    const home2 = await getText('/');
    check('重启后整站恢复（GET / 200）', home2.status === 200 && home2.text.includes('id="app"'), home2.status);
    stopBackend(srv2b);
    check('服务停止', await waitDown());

    // ============================== 阶段 3 ==============================
    stage('3 旧构建产物：真实重新构建后内容更新');
    // 伪造一份"旧构建产物"
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'),
      '<!DOCTYPE html><html><head><title>stale</title></head>'
      + '<body>STALE_BUILD_MARKER<script src="/assets/stale-legacy.js"></script></body></html>');
    fs.writeFileSync(path.join(distDir, 'assets', 'stale-legacy.js'), '/* stale build */');
    const srv3 = startBackend(workDir);
    check('后端启动（托管旧产物）', await waitUp(), srv3.log.slice(-300));
    const staleHome = await getText('/');
    check('GET / 返回旧构建产物内容', staleHome.status === 200 && staleHome.text.includes('STALE_BUILD_MARKER'));
    const staleAsset = await getText('/assets/stale-legacy.js');
    check('旧产物资源可访问', staleAsset.status === 200);
    // 真实重新构建（不重启后端，express.static 按请求读盘）
    const build3 = run('npm', ['run', 'build'], frontendDir);
    check('真实重新构建成功', build3.code === 0, (build3.stderr || build3.stdout).slice(-300));
    const freshHome = await getText('/');
    check('重新构建后 GET / 不再含旧标记', freshHome.status === 200 && !freshHome.text.includes('STALE_BUILD_MARKER'));
    check('重新构建后页面为当前应用', freshHome.text.includes('id="app"'));
    const staleGone = await getText('/assets/stale-legacy.js');
    check('旧产物资源已失效（不再返回旧内容）', !staleGone.text.includes('stale build'),
      `status=${staleGone.status}`);
    stopBackend(srv3);
    check('服务停止', await waitDown());

    // ============================== 阶段 4 ==============================
    stage('4 真实构建失败：退出码非零、错误清楚、环境可恢复');
    const mainJs = path.join(frontendDir, 'src', 'main.js');
    const mainJsBak = fs.readFileSync(mainJs, 'utf8');
    fs.writeFileSync(mainJs, 'import { broken from nowhere;\n'); // 注入语法错误（仅作用于临时副本）
    const buildFail = run('npm', ['run', 'build'], frontendDir);
    check('构建失败退出码非零', buildFail.code !== 0, `exit=${buildFail.code}`);
    check('构建失败输出含错误信息',
      /error|ERROR|Failed|failed/i.test(buildFail.stderr + buildFail.stdout),
      (buildFail.stderr || buildFail.stdout).slice(-200));
    // 恢复源码后可再次成功构建（环境自恢复，保证连续运行稳定）
    fs.writeFileSync(mainJs, mainJsBak);
    const buildRecover = run('npm', ['run', 'build'], frontendDir);
    check('恢复后重新构建成功', buildRecover.code === 0, (buildRecover.stderr || buildRecover.stdout).slice(-300));
    check('恢复后产物重新生成', fs.existsSync(path.join(distDir, 'index.html')));
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
