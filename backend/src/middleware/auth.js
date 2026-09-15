'use strict';

const { userByToken } = require('../services/authService');
const { ApiError } = require('../errors');

/** 解析 Bearer Token，注入 req.user；未登录抛 401 */
function authRequired(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = userByToken(token);
  if (!user) return next(new ApiError('AUTH_REQUIRED'));
  req.user = user;
  req.token = token;
  next();
}

/** 角色守卫：仅允许指定角色执行 */
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ApiError('FORBIDDEN'));
    }
    next();
  };
}

module.exports = { authRequired, requireRole };
