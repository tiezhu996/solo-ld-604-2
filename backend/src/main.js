'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const { initDb } = require('./db');
const { seedIfEmpty } = require('./seed');
const { ensureFrontendAssets, resolveFrontendDir } = require('./frontendAssets');
const apiRoutes = require('./routes');
const { rateLimit } = require('./middleware/rateLimit');
const { errorHandler, requestLogger } = require('./middleware/errorHandler');

const PORT = Number(process.env.PORT || 21104);

async function main() {
  // 启动前置：前端产物缺失/过期时自动补齐，补齐失败直接终止（exit 1）
  ensureFrontendAssets();

  await initDb();
  if (seedIfEmpty()) console.log('空库 detected，已写入种子数据');

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));
  app.use(requestLogger);
  app.use(rateLimit);

  app.get('/health', (_req, res) => res.json({ ok: true, service: 'grid-repair', time: new Date().toISOString() }));
  app.use('/api', apiRoutes);

  // 托管前端构建产物（存在时），非 /api 路径回退到 index.html
  const distDir = path.join(resolveFrontendDir(), 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
    console.log(`已托管前端静态资源: ${distDir}`);
  }

  app.use(errorHandler);

  app.listen(PORT, () => {
    console.log(`grid-repair 后端已启动: http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('启动失败:', err);
  process.exit(1);
});
