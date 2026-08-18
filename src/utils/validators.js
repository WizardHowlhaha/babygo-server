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
const BLOCKED_TERMS = ['裸照', '虐童', '代购疫苗', '加微信'];
function isContentSafe(text) {
  const t = String(text || '');
  const hasPhone = /(?<!\d)1[3-9]\d{9}(?!\d)/.test(t);
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
