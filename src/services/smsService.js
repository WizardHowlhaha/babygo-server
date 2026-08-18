'use strict';
const config = require('../config');
const logger = require('../utils/logger');

// ============================================================
// 短信验证码服务 —— 预留接口 (桩实现)
// 现状: 尚未申请 SMS 服务商, config.sms.enabled === false
// 接入后: 在 sendCode 内改为真实调用阿里云/腾讯云短信 API, 并把验证码写入 Redis
// 当前桩逻辑: 开发环境固定验证码 123456, 存内存 Map, 5 分钟过期, 60 秒冷却
// ============================================================

const store = new Map(); // phone:purpose -> { code, expireAt, lastSentAt, dailyCount, day }
const CODE_TTL_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;
const DAILY_LIMIT = 10;
const DEV_FIXED_CODE = '123456';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function storeKey(phone, purpose) {
  return `${phone}:${purpose}`;
}

async function sendCode(phone, purpose) {
  if (config.sms.configured) {
    const err = new Error('短信服务配置已填写，但 provider 适配器尚未实现');
    err.code = 'SMS_PROVIDER_NOT_IMPLEMENTED';
    err.status = 501;
    throw err;
  }
  if (!config.auth.allowInsecureDevAuth) {
    const err = new Error('短信服务尚未配置，请稍后再试');
    err.code = 'SMS_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }

  const now = Date.now();
  const key = storeKey(phone, purpose);
  const rec = store.get(key);
  const day = todayKey();
  if (rec) {
    if (rec.day === day && rec.dailyCount >= DAILY_LIMIT) {
      const err = new Error('今天的验证码次数已达上限，请明天再试');
      err.code = 'SMS_DAILY_LIMIT';
      throw err;
    }
    if (now - rec.lastSentAt < COOLDOWN_MS) {
      const wait = Math.ceil((COOLDOWN_MS - (now - rec.lastSentAt)) / 1000);
      const err = new Error(`请求过于频繁，请在 ${wait} 秒后重试`);
      err.code = 'SMS_COOLDOWN';
      throw err;
    }
  }
  const code = DEV_FIXED_CODE;
  logger.info('sms.stub.code.generated', { purpose });

  const prevCount = rec && rec.day === day ? rec.dailyCount : 0;
  store.set(key, {
    code,
    expireAt: now + CODE_TTL_MS,
    lastSentAt: now,
    dailyCount: prevCount + 1,
    day,
  });
  // 仅显式允许的不安全开发模式回传演示码。
  return { devCode: code };
}

function verifyCode(phone, code, purpose) {
  const key = storeKey(phone, purpose);
  const rec = store.get(key);
  if (!rec) return false;
  if (Date.now() > rec.expireAt) { store.delete(key); return false; }
  const ok = rec.code === String(code);
  if (ok) store.delete(key); // 一次性
  return ok;
}

module.exports = {
  sendCode,
  verifyCode,
  configured: () => config.sms.configured,
  available: () => false,
  developmentStubEnabled: () => !config.sms.configured && config.auth.allowInsecureDevAuth,
};
