'use strict';
const bcrypt = require('bcryptjs');

// 密码规则: 8-32 位, 同时含字母和数字 (与 iOS 端 PasswordValidator 保持一致)
function isValidPassword(pwd) {
  if (typeof pwd !== 'string') return false;
  if (pwd.length < 8 || pwd.length > 32) return false;
  return /[A-Za-z]/.test(pwd) && /[0-9]/.test(pwd);
}

async function hashPassword(pwd) {
  return bcrypt.hash(pwd, 10);
}

async function verifyPassword(pwd, hash) {
  if (!hash) return false;
  return bcrypt.compare(pwd, hash);
}

module.exports = { isValidPassword, hashPassword, verifyPassword };
