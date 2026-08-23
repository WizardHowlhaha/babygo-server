'use strict';

// 手机号: 11 位, 1 开头
function normalizePhone(input) {
  return String(input || '').replace(/\D/g, '');
}
function isValidPhone(input) {
  const p = normalizePhone(input);
  return p.length === 11 && p.startsWith('1');
}

// 内容安全: 拦截手机号与违禁词 (与 iOS 端 ContentSafetyValidator 一致, 生产应换成云审核)
// FIXME: 此处正则仅为临时缓解，最终应使用云审核服务 (如阿里云内容安全)
const BLOCKED_TERMS = ['裸照', '虐童', '代购疫苗', '加微信', '加薇', '加vx', 'vx', 'v我', '微'];
function isContentSafe(text) {
  const t = String(text || '');
  // 手机号: 检测 11 位数字，移除空格/分隔符后匹配
  const digitsOnly = t.replace(/[\s\-（）\(\)]/g, '');
  const hasPhone = /(?<!\d)1[3-9]\d{9}(?!\d)/.test(t) || (digitsOnly.length >= 11 && /(?<!\d)1[3-9]\d{9}(?!\d)/.test(digitsOnly));
  const hasBlocked = BLOCKED_TERMS.some((w) => t.includes(w));
  return !hasPhone && !hasBlocked;
}

// 用户名: 4-20 位, 字母开头, 仅字母/数字/下划线 (与 iOS UsernameValidator 一致)
function normalizeUsername(input) {
  return String(input || "").trim();
}
function usernameKey(input) {
  return normalizeUsername(input).toLowerCase();
}
function isValidUsername(input) {
  return /^[A-Za-z][A-Za-z0-9_]{3,19}$/.test(normalizeUsername(input));
}

module.exports = {
  normalizePhone,
  isValidPhone,
  isContentSafe,
  normalizeUsername,
  usernameKey,
  isValidUsername,
};
