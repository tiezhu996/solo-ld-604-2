'use strict';

const { ApiError } = require('../errors');

/** 简单滑动窗口限流：每 IP 每分钟 240 次，登录等写操作共用同一窗口 */
const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 240;
const hits = new Map(); // ip -> number[]

function rateLimit(req, _res, next) {
  const nowTs = Date.now();
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  let arr = hits.get(ip);
  if (!arr) {
    arr = [];
    hits.set(ip, arr);
  }
  while (arr.length && nowTs - arr[0] > WINDOW_MS) arr.shift();
  if (arr.length >= MAX_REQUESTS) return next(new ApiError('RATE_LIMITED'));
  arr.push(nowTs);
  next();
}

// 定期清理空窗口，避免内存缓慢增长
setInterval(() => {
  const nowTs = Date.now();
  for (const [ip, arr] of hits) {
    if (!arr.length || nowTs - arr[arr.length - 1] > WINDOW_MS) hits.delete(ip);
  }
}, WINDOW_MS).unref();

module.exports = { rateLimit };
