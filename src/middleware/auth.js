'use strict';
const { verifyToken } = require('../utils/jwt');
const { ApiError } = require('./errorHandler');
const { query } = require('../db');

// 鉴权中间件: 从 Authorization: Bearer <token> 解析出当前用户 id, 挂到 req.userId
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return next(new ApiError(401, '请先登录', 'UNAUTHORIZED'));
  let payload;
  try {
    payload = verifyToken(token);
    if (!payload.uid || String(payload.sub) !== String(payload.uid)) {
      throw new Error('token subject mismatch');
    }
  } catch (error) {
    return next(new ApiError(401, '登录已过期，请重新登录', 'TOKEN_INVALID'));
  }

  try {
    const { rows } = await query(
      'SELECT token_version FROM users WHERE id = $1',
      [payload.uid]
    );
    if (!rows[0] || Number(payload.ver ?? 0) !== Number(rows[0].token_version)) {
      throw new Error('token revoked');
    }
    req.userId = payload.uid;
    return next();
  } catch (error) {
    if (error?.message === 'token revoked') {
      return next(new ApiError(401, '登录已过期，请重新登录', 'TOKEN_INVALID'));
    }
    return next(error);
  }
}

module.exports = { requireAuth };
