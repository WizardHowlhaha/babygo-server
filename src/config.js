'use strict';
require('dotenv').config();

const DEFAULT_JWT_SECRET = 'dev-only-please-change-me-in-production';
const DEFAULT_DATABASE_URL = 'postgres://babygo:babygo_pass@localhost:5432/babygo';

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function buildConfig(env = process.env) {
  const environment = env.NODE_ENV || 'development';
  return {
    port: Number.parseInt(env.PORT || '3000', 10),
    env: environment,
    databaseUrl: env.DATABASE_URL || DEFAULT_DATABASE_URL,
    trustProxy: parseBoolean(env.TRUST_PROXY, false),
    corsOrigins: String(env.CORS_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    auth: {
      allowInsecureDevAuth: parseBoolean(
        env.ALLOW_INSECURE_DEV_AUTH,
        false
      ),
    },
    jwt: {
      secret: env.JWT_SECRET || DEFAULT_JWT_SECRET,
      expiresIn: env.JWT_EXPIRES_IN || '30d',
      issuer: env.JWT_ISSUER || 'babygo-server',
      audience: env.JWT_AUDIENCE || 'babygo-app',
    },
    log: {
      level: (env.LOG_LEVEL || 'info').toLowerCase(),
      file: env.LOG_FILE || (environment === 'production' ? '' : 'logs/babygo-server.log'),
    },
    sms: {
      provider: env.SMS_PROVIDER || '',
      accessKey: env.SMS_ACCESS_KEY || '',
      secretKey: env.SMS_SECRET_KEY || '',
      signName: env.SMS_SIGN_NAME || '',
      templateCode: env.SMS_TEMPLATE_CODE || '',
      get configured() {
        return Boolean(
          this.provider &&
          this.accessKey &&
          this.secretKey &&
          this.signName &&
          this.templateCode
        );
      },
    },
    wechat: {
      appId: env.WECHAT_APP_ID || '',
      appSecret: env.WECHAT_APP_SECRET || '',
      get enabled() { return Boolean(this.appId && this.appSecret); },
    },
    oss: {
      provider: env.OSS_PROVIDER || '',
      bucket: env.OSS_BUCKET || '',
      region: env.OSS_REGION || '',
      accessKey: env.OSS_ACCESS_KEY || '',
      secretKey: env.OSS_SECRET_KEY || '',
      publicBaseUrl: env.OSS_PUBLIC_BASE_URL || '',
      get enabled() {
        return Boolean(
          this.provider &&
          this.bucket &&
          this.region &&
          this.accessKey &&
          this.secretKey &&
          this.publicBaseUrl
        );
      },
    },
  };
}

function validateConfig(config) {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  if (config.env === 'production') {
    if (!config.jwt.secret || config.jwt.secret === DEFAULT_JWT_SECRET || config.jwt.secret.length < 32) {
      throw new Error('JWT_SECRET must be a strong value of at least 32 characters in production');
    }
    if (config.auth.allowInsecureDevAuth) {
      throw new Error('ALLOW_INSECURE_DEV_AUTH must be disabled in production');
    }
    if (config.databaseUrl === DEFAULT_DATABASE_URL) {
      throw new Error('DATABASE_URL must be explicitly configured in production');
    }
  }
  return config;
}

const config = validateConfig(buildConfig());

module.exports = config;
module.exports.buildConfig = buildConfig;
module.exports.validateConfig = validateConfig;
module.exports.DEFAULT_JWT_SECRET = DEFAULT_JWT_SECRET;
module.exports.DEFAULT_DATABASE_URL = DEFAULT_DATABASE_URL;
