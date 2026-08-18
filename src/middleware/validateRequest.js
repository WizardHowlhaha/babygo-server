'use strict';
const { ApiError } = require('./errorHandler');

function requirePositiveIntegerParam(name) {
  return (req, res, next, value) => {
    if (!/^[1-9]\d*$/.test(String(value))) {
      return next(new ApiError(400, '资源 ID 格式不正确', 'INVALID_ID'));
    }
    return next();
  };
}

module.exports = { requirePositiveIntegerParam };
