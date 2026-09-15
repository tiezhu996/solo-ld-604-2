'use strict';

const { ApiError } = require('../errors');
const { ErrorCodes } = require('../constants');

/** 统一错误响应：{ error: { code, message, detail? } } */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, detail: err.detail },
    });
  }
  if (err && err.type === 'entity.parse.failed') {
    const [status, message] = [400, ErrorCodes.VALIDATION_ERROR[1]];
    return res.status(status).json({ error: { code: 'VALIDATION_ERROR', message: '请求体不是合法 JSON' } });
  }
  console.error(`[ERROR] ${req.method} ${req.path}:`, err);
  const [status, message] = ErrorCodes.INTERNAL;
  res.status(status).json({ error: { code: 'INTERNAL', message } });
}

function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const user = req.user ? `${req.user.username}` : '-';
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms ${user}`);
  });
  next();
}

module.exports = { errorHandler, requestLogger };
