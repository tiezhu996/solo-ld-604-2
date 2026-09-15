'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** 前端源码目录：默认仓库布局的 ../frontend，可用环境变量覆盖 */
function resolveFrontendDir() {
  return process.env.GRID_REPAIR_FRONTEND_DIR || path.join(__dirname, '..', '..', 'frontend');
}

function newestMtime(dir) {
  let max = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) max = Math.max(max, newestMtime(p));
    else max = Math.max(max, fs.statSync(p).mtimeMs);
  }
  return max;
}

/** dist 是否落后于前端源码（旧资源不能掩盖当前源码） */
function isStale(frontendDir, distIndex) {
  const distTime = fs.statSync(distIndex).mtimeMs;
  let newest = newestMtime(path.join(frontendDir, 'src'));
  for (const f of ['index.html', 'vite.config.js', 'package.json', 'package-lock.json']) {
    const p = path.join(frontendDir, f);
    if (fs.existsSync(p)) newest = Math.max(newest, fs.statSync(p).mtimeMs);
  }
  return newest > distTime;
}

function runStep(args, cwd, label) {
  console.log(`[frontend] ${label}…`);
  const res = spawnSync(NPM, args, { cwd, stdio: 'inherit', timeout: 600000 });
  if (res.error || res.status !== 0) {
    console.error(`[frontend] ${label}失败（${res.error ? res.error.message : `退出码 ${res.status}`}）`);
    return false;
  }
  return true;
}

/**
 * 启动前确保前端构建产物可用：
 * - 前端源码目录不存在（如后端独立容器）→ 跳过，仅提供接口；
 * - 产物缺失或已落后于源码 → 自动安装依赖（如需）并重新构建；
 * - 补齐失败 → 打印清晰错误并终止进程，绝不留下"只有健康检查"的半截服务。
 */
function ensureFrontendAssets() {
  if (process.env.GRID_REPAIR_SKIP_FRONTEND_BUILD === '1') return;
  const frontendDir = resolveFrontendDir();
  if (!fs.existsSync(path.join(frontendDir, 'package.json'))) {
    console.log(`[frontend] 未找到前端源码目录（${frontendDir}），仅启动接口服务`);
    return;
  }
  const distIndex = path.join(frontendDir, 'dist', 'index.html');
  const missing = !fs.existsSync(distIndex);
  if (!missing && !isStale(frontendDir, distIndex)) return;

  console.log(`[frontend] 构建产物${missing ? '缺失' : '已落后于当前源码'}，自动补齐…`);
  if (!fs.existsSync(path.join(frontendDir, 'node_modules'))) {
    if (!runStep(['install'], frontendDir, '安装前端依赖（npm install）')) {
      console.error('[frontend] 前端依赖安装失败，无法生成页面资源，服务终止。');
      process.exit(1);
    }
  }
  if (!runStep(['run', 'build'], frontendDir, '构建前端资源（npm run build）')) {
    console.error('[frontend] 前端构建失败，无法提供页面入口，服务终止。请根据上方构建日志修复后重试。');
    process.exit(1);
  }
  if (!fs.existsSync(distIndex)) {
    console.error('[frontend] 构建结束但未生成 dist/index.html，服务终止。');
    process.exit(1);
  }
  console.log('[frontend] 构建产物已就绪');
}

module.exports = { ensureFrontendAssets, resolveFrontendDir };
