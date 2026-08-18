'use strict';
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const { pool, closePool } = require('./db');
const { ApiError, errorHandler } = require('./middleware/errorHandler');
const { requestLogger } = require('./middleware/requestLogger');
const logger = require('./utils/logger');

const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const commentRoutes = require('./routes/comments');
const planRoutes = require('./routes/plans');
const friendRoutes = require('./routes/friends');
const mediaRoutes = require('./routes/media');
const babyRoutes = require('./routes/babies');
const smsService = require('./services/smsService');
const wechatService = require('./services/wechatService');
const mediaService = require('./services/mediaService');
const { runMigrations } = require('./scripts/migrate');
const { requirePositiveIntegerParam } = require('./middleware/validateRequest');

function corsOptions() {
  if (config.corsOrigins.length === 0) return { origin: false };
  return {
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
  };
}

function createApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);

  app.disable('x-powered-by');
  app.use(cors(corsOptions()));
  app.use(requestLogger);

  const globalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(globalLimiter);
  app.use(express.json({ limit: '1mb' }));
  app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return next(new ApiError(400, '请求 JSON 格式不正确', 'INVALID_JSON'));
    }
    return next(error);
  });
  app.use((req, res, next) => {
    if (
      ['POST', 'PUT', 'PATCH'].includes(req.method) &&
      (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
    ) {
      return next(new ApiError(400, '请求体必须是 JSON 对象', 'INVALID_BODY'));
    }
    return next();
  });

  app.param('postId', requirePositiveIntegerParam('postId'));

  app.get('/health', async (req, res) => {
    let db = 'down';
    try { await pool.query('SELECT 1'); db = 'up'; } catch (error) { db = 'down'; }
    res.status(db === 'up' ? 200 : 503).json({
      ok: db === 'up',
      env: config.env,
      db,
      features: {
        sms: smsService.available(),
        smsDevelopmentStub: smsService.developmentStubEnabled(),
        wechat: wechatService.available(),
        oss: mediaService.available(),
      },
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/posts', postRoutes);
  app.use('/api/posts/:postId/comments', commentRoutes);
  app.use('/api/plans', planRoutes);
  app.use('/api/friends', friendRoutes);
  app.use('/api/media', mediaRoutes);
  app.use('/api/babies', babyRoutes);

  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: { code: 'NOT_FOUND', message: '接口不存在' },
      requestId: req.requestId,
    });
  });

  app.use(errorHandler);
  return app;
}

async function startServer() {
  await runMigrations();
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info('server.started', {
      port: config.port,
      features: {
        sms: smsService.available(),
        smsDevelopmentStub: smsService.developmentStubEnabled(),
        wechat: wechatService.available(),
        oss: mediaService.available(),
      },
    });
  });

  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    logger.info('server.stopping', { signal });

    const forceTimer = setTimeout(() => {
      logger.error('server.stop.timeout', { signal });
      server.closeAllConnections?.();
    }, 10_000);
    forceTimer.unref();

    server.closeIdleConnections?.();
    server.close(async (error) => {
      if (error) logger.error('server.stop.failed', { signal, error });
      try {
        await closePool();
        await logger.close();
        process.exit(error ? 1 : 0);
      } catch (poolError) {
        logger.error('db.pool.close.failed', { signal, error: poolError });
        process.exit(1);
      }
    });
  }

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  return { app, server, shutdown };
}

if (require.main === module) {
  startServer().catch(async (error) => {
    logger.error('server.start.failed', { error });
    try { await closePool(); } catch (closeError) { /* process is already failing */ }
    process.exitCode = 1;
  });
}

module.exports = { createApp, startServer };
