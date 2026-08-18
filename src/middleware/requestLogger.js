'use strict';
const { randomUUID } = require('crypto');
const logger = require('../utils/logger');

function requestLogger(req, res, next) {
  const incomingRequestId = req.get('x-request-id');
  const requestId = incomingRequestId && /^[A-Za-z0-9._-]{1,128}$/.test(incomingRequestId)
    ? incomingRequestId
    : randomUUID();
  const startedAt = process.hrtime.bigint();

  req.requestId = requestId;
  req.logPath = req.originalUrl.split('?')[0];
  res.setHeader('X-Request-ID', requestId);

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const fields = {
      requestId,
      method: req.method,
      path: req.logPath,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
    };
    if (res.statusCode >= 500 && res.statusCode !== 501) {
      logger.error('http.request.completed', fields);
    } else if (res.statusCode >= 400) {
      logger.warn('http.request.completed', fields);
    } else {
      logger.info('http.request.completed', fields);
    }
  });

  next();
}

module.exports = { requestLogger };
