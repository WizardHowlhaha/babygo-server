'use strict';
const logger = require('../utils/logger');

// 统一的业务错误: 抛出它即可携带 HTTP 状态码与提示
class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'ERROR';
  }
}

// 兜底错误处理中间件 (放在所有路由之后)
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof ApiError) {
    logger.warn('http.request.rejected', {
      requestId: req.requestId,
      method: req.method,
      path: req.logPath || req.path,
      status: err.status,
      code: err.code,
    });
    return res.status(err.status).json({
      ok: false,
      error: { code: err.code, message: err.message },
      requestId: req.requestId,
    });
  }
  logger.error('http.request.failed', {
    requestId: req.requestId,
    method: req.method,
    path: req.logPath || req.path,
    error: err,
  });
  return res.status(500).json({
    ok: false,
    error: { code: 'INTERNAL', message: '服务器开小差了，请稍后重试' },
    requestId: req.requestId,
  });
}

// 包裹异步路由, 自动把抛出的错误转给 errorHandler, 省去每个 handler 写 try/catch
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { ApiError, errorHandler, asyncHandler };
