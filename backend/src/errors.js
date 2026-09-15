'use strict';

/** 统一业务异常：携带错误码，由全局错误中间件转换为一致的错误响应 */
const { ErrorCodes } = require('./constants');

class ApiError extends Error {
  /**
   * @param {keyof typeof ErrorCodes} code 错误码
   * @param {string} [message] 覆盖默认提示
   * @param {object} [detail] 附加上下文（如冲突的班组/工单）
   */
  constructor(code, message, detail) {
    const def = ErrorCodes[code] || ErrorCodes.INTERNAL;
    super(message || def[1]);
    this.code = code;
    this.status = def[0];
    this.detail = detail;
  }
}

module.exports = { ApiError };
