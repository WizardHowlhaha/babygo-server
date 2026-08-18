'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { isValidPassword, hashPassword, verifyPassword } = require('../utils/password');
const { isValidPhone, normalizePhone } = require('../utils/validators');
const { signToken } = require('../utils/jwt');
const sms = require('../services/smsService');
const wechat = require('../services/wechatService');

const router = express.Router();
const { isValidUsername, normalizeUsername, usernameKey } = require("../utils/validators");

const credentialLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    ok: false,
    error: { code: 'AUTH_RATE_LIMITED', message: '登录尝试过于频繁，请稍后再试' },
  },
});
const smsLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: { code: 'SMS_RATE_LIMITED', message: '验证码请求过于频繁，请稍后再试' },
  },
});

// 把数据库 user 行转成对外安全字段 (绝不返回 password_hash)
function publicUser(u) {
  return {
    id: String(u.id),
    phone: u.phone,
    nickname: u.nickname,
    avatar: u.avatar,
    bio: u.bio,
    city: u.city,
    isVerified: u.is_verified,
    isWeChatBound: u.is_wechat_bound,
    username: u.username,
    privacy: {
      showBabyAge: u.show_baby_age !== false,
      allowNearbyDiscovery: u.allow_nearby_discovery !== false,
      allowFriendRequests: u.allow_friend_requests !== false,
    },
  };
}

async function findUserByPhone(phone) {
  const { rows } = await query('SELECT * FROM users WHERE phone = $1', [phone]);
  return rows[0] || null;
}

function issueSession(user) {
  return { token: signToken(user.id, user.token_version), user: publicUser(user) };
}

async function findUserByUsername(username) {
  const { rows } = await query("SELECT * FROM users WHERE lower(username) = lower($1)", [username]);
  return rows[0] || null;
}

async function suggestUsernames(base, count) {
  const root = (normalizeUsername(base) || "baby").slice(0, 12);
  const suffixes = ["baby", "go", "2026", "mama"];
  const out = [];
  const tried = new Set();
  let guard = 0;
  while (out.length < count && guard < 100) {
    guard += 1;
    let candidate;
    if (guard <= suffixes.length) {
      candidate = root + suffixes[guard - 1];
    } else {
      candidate = root + Math.floor(1000 + Math.random() * 9000);
    }
    const key = usernameKey(candidate);
    if (tried.has(key)) continue;
    tried.add(key);
    if (!isValidUsername(candidate)) continue;
    const exists = await findUserByUsername(candidate);
    if (!exists) out.push(candidate);
  }
  return out;
}

// ---------- 方式一: 账号(手机号)+ 密码 注册 (手动注册, 始终可用) ----------
router.post('/register', asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const { password, nickname, code } = req.body;
  if (!isValidPhone(phone)) throw new ApiError(400, '请输入正确的 11 位手机号', 'INVALID_PHONE');
  if (!isValidPassword(password)) throw new ApiError(400, '密码需为 8–32 位，并同时包含字母和数字', 'INVALID_PASSWORD');
  if (!sms.verifyCode(phone, code, 'register')) throw new ApiError(400, '验证码错误或已过期', 'INVALID_CODE');
  if (await findUserByPhone(phone)) throw new ApiError(409, '该手机号已经注册', 'PHONE_REGISTERED');

  const hash = await hashPassword(password);
  const name = (nickname && String(nickname).trim()) || `家长${phone.slice(-4)}`;
  if (name.length > 32) throw new ApiError(400, '昵称不能超过 32 个字符', 'NICKNAME_TOO_LONG');
  try {
    const { rows } = await query(
      'INSERT INTO users (phone, password_hash, nickname) VALUES ($1,$2,$3) RETURNING *',
      [phone, hash, name]
    );
    res.status(201).json({ ok: true, data: issueSession(rows[0]) });
  } catch (error) {
    if (error?.code === '23505') {
      throw new ApiError(409, '该手机号已经注册', 'PHONE_REGISTERED');
    }
    throw error;
  }
}));

// ---------- 方式一: 账号 + 密码 登录 ----------
router.post('/login', credentialLimiter, asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const { password } = req.body;
  if (!isValidPhone(phone)) throw new ApiError(400, '请输入正确的 11 位手机号', 'INVALID_PHONE');
  const user = await findUserByPhone(phone);
  const ok = user ? await verifyPassword(password, user.password_hash) : false;
  if (!ok) throw new ApiError(401, '手机号或密码不正确', 'WRONG_CREDENTIALS');
  res.json({ ok: true, data: issueSession(user) });
}));

// ---------- 方式二: 手机验证码 (预留, 桩实现) ----------
// 发送验证码
router.post('/sms/send', smsLimiter, asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const purpose = req.body.purpose || 'login';
  if (!isValidPhone(phone)) throw new ApiError(400, '请输入正确的 11 位手机号', 'INVALID_PHONE');
  if (!['login', 'register', 'resetPassword'].includes(purpose)) {
    throw new ApiError(400, '验证码用途不正确', 'INVALID_PURPOSE');
  }
  let result;
  try {
    result = await sms.sendCode(phone, purpose);
  } catch (error) {
    if (error?.code === 'SMS_NOT_CONFIGURED' || error?.code === 'SMS_PROVIDER_NOT_IMPLEMENTED') {
      throw new ApiError(error.status || 503, error.message, error.code);
    }
    if (error?.code === 'SMS_DAILY_LIMIT' || error?.code === 'SMS_COOLDOWN') {
      throw new ApiError(429, error.message, error.code);
    }
    throw error;
  }
  res.json({
    ok: true,
    data: {
      smsConfigured: sms.configured(),
      developmentStub: sms.developmentStubEnabled(),
      devCode: result.devCode,
      message: sms.configured() ? '验证码已发送' : '开发模式验证码已生成',
    },
  });
}));

// 验证码登录 / 注册即登录
router.post('/sms/login', credentialLimiter, asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const { code } = req.body;
  if (!isValidPhone(phone)) throw new ApiError(400, '请输入正确的 11 位手机号', 'INVALID_PHONE');
  if (!sms.verifyCode(phone, code, 'login')) throw new ApiError(400, '验证码错误或已过期', 'INVALID_CODE');

  let user = await findUserByPhone(phone);
  if (!user) {
    // 验证码登录即注册: 自动建号
    try {
      const { rows } = await query(
        'INSERT INTO users (phone, nickname) VALUES ($1,$2) RETURNING *',
        [phone, `家长${phone.slice(-4)}`]
      );
      user = rows[0];
    } catch (error) {
      if (error?.code !== '23505') throw error;
      user = await findUserByPhone(phone);
    }
  }
  res.json({ ok: true, data: issueSession(user) });
}));

router.post('/reset-password', credentialLimiter, asyncHandler(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const { code, newPassword } = req.body;
  if (!isValidPhone(phone)) throw new ApiError(400, '请输入正确的 11 位手机号', 'INVALID_PHONE');
  if (!isValidPassword(newPassword)) {
    throw new ApiError(400, '密码需为 8–32 位，并同时包含字母和数字', 'INVALID_PASSWORD');
  }
  if (!sms.verifyCode(phone, code, 'resetPassword')) {
    throw new ApiError(400, '验证码错误或已过期', 'INVALID_CODE');
  }
  const user = await findUserByPhone(phone);
  if (!user) {
    throw new ApiError(400, '验证码错误或已过期', 'INVALID_CODE');
  }
  const hash = await hashPassword(newPassword);
  await query(
    `UPDATE users
     SET password_hash = $1, token_version = token_version + 1, updated_at = NOW()
     WHERE id = $2`,
    [hash, user.id]
  );
  res.json({ ok: true });
}));

// ---------- 方式三: 微信登录 (预留, 桩实现) ----------
router.post('/wechat', asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) throw new ApiError(400, '缺少微信授权 code', 'MISSING_CODE');
  if (!wechat.configured()) {
    throw new ApiError(501, '微信登录尚未配置，请使用手机号或账号密码登录', 'WECHAT_NOT_CONFIGURED');
  }
  let profile;
  try {
    profile = await wechat.exchangeCode(code); // { unionid, nickname, avatar }
  } catch (error) {
    if (error?.code === 'WECHAT_PROVIDER_NOT_IMPLEMENTED') {
      throw new ApiError(error.status || 501, error.message, error.code);
    }
    throw error;
  }
  let user;
  const { rows } = await query('SELECT * FROM users WHERE wechat_unionid = $1', [profile.unionid]);
  if (rows[0]) {
    user = rows[0];
  } else {
    const ins = await query(
      'INSERT INTO users (wechat_unionid, nickname, avatar, is_wechat_bound) VALUES ($1,$2,$3,TRUE) RETURNING *',
      [profile.unionid, profile.nickname || '微信用户', profile.avatar || '']
    );
    user = ins.rows[0];
  }
  res.json({ ok: true, data: issueSession(user) });
}));

// ---------- 方式四: 用户名 + 密码 注册 / 查重 ----------
router.post("/check-username", asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  if (!isValidUsername(username)) {
    throw new ApiError(400, "用户名需 4-20 位，以字母开头，仅含字母、数字或下划线", "INVALID_USERNAME");
  }
  const existing = await findUserByUsername(username);
  if (!existing) {
    res.json({ ok: true, data: { available: true, suggestions: [] } });
    return;
  }
  const suggestions = await suggestUsernames(username, 3);
  res.json({ ok: true, data: { available: false, suggestions } });
}));

router.post("/register-username", asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const { password, nickname } = req.body;
  if (!isValidUsername(username)) {
    throw new ApiError(400, "用户名需 4-20 位，以字母开头，仅含字母、数字或下划线", "INVALID_USERNAME");
  }
  if (!isValidPassword(password)) {
    throw new ApiError(400, "密码需为 8-32 位，并同时包含字母和数字", "INVALID_PASSWORD");
  }
  if (await findUserByUsername(username)) {
    throw new ApiError(409, "该用户名已被占用，换一个试试", "USERNAME_TAKEN");
  }
  const hash = await hashPassword(password);
  const name = (nickname && String(nickname).trim()) || username;
  if (name.length > 32) throw new ApiError(400, "昵称不能超过 32 个字符", "NICKNAME_TOO_LONG");
  try {
    const { rows } = await query(
      "INSERT INTO users (username, password_hash, nickname) VALUES ($1,$2,$3) RETURNING *",
      [username, hash, name]
    );
    res.status(201).json({ ok: true, data: issueSession(rows[0]) });
  } catch (e) {
    if (e && e.code === "23505") {
      throw new ApiError(409, "该用户名已被占用，换一个试试", "USERNAME_TAKEN");
    }
    throw e;
  }
}));

// ---------- 方式四: 用户名 + 密码 登录 ----------
router.post("/login-username", credentialLimiter, asyncHandler(async (req, res) => {
  const username = normalizeUsername(req.body.username);
  const { password } = req.body;
  if (!isValidUsername(username)) {
    throw new ApiError(400, "用户名需 4-20 位，以字母开头，仅含字母、数字或下划线", "INVALID_USERNAME");
  }
  const user = await findUserByUsername(username);
  const ok = user?.password_hash ? await verifyPassword(password, user.password_hash) : false;
  if (!ok) throw new ApiError(401, "用户名或密码不正确", "WRONG_CREDENTIALS");
  res.json({ ok: true, data: issueSession(user) });
}));

// ---------- 当前用户信息 ----------
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.userId]);
  if (!rows[0]) throw new ApiError(404, '用户不存在', 'USER_NOT_FOUND');
  res.json({ ok: true, data: publicUser(rows[0]) });
}));

router.patch('/privacy', requireAuth, asyncHandler(async (req, res) => {
  const allowedKeys = ['showBabyAge', 'allowNearbyDiscovery', 'allowFriendRequests'];
  const providedKeys = Object.keys(req.body);
  if (
    providedKeys.length === 0 ||
    providedKeys.some((key) => !allowedKeys.includes(key)) ||
    providedKeys.some((key) => typeof req.body[key] !== 'boolean')
  ) {
    throw new ApiError(400, '隐私设置参数不正确', 'BAD_PRIVACY_SETTINGS');
  }

  const { rows } = await query(
    `UPDATE users
     SET show_baby_age = COALESCE($1, show_baby_age),
         allow_nearby_discovery = COALESCE($2, allow_nearby_discovery),
         allow_friend_requests = COALESCE($3, allow_friend_requests),
         updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [
      req.body.showBabyAge ?? null,
      req.body.allowNearbyDiscovery ?? null,
      req.body.allowFriendRequests ?? null,
      req.userId,
    ]
  );
  res.json({ ok: true, data: publicUser(rows[0]) });
}));

// ---------- 修改密码 ----------
router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!isValidPassword(newPassword)) throw new ApiError(400, '新密码需为 8–32 位，并同时包含字母和数字', 'INVALID_PASSWORD');
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.userId]);
  const user = rows[0];
  if (!user) throw new ApiError(404, '用户不存在', 'USER_NOT_FOUND');
  if (user.password_hash) {
    const ok = await verifyPassword(oldPassword, user.password_hash);
    if (!ok) throw new ApiError(401, '原密码不正确', 'WRONG_CREDENTIALS');
  }
  const hash = await hashPassword(newPassword);
  const { rows: updated } = await query(
    `UPDATE users
     SET password_hash = $1, token_version = token_version + 1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [hash, req.userId]
  );
  res.json({ ok: true, data: issueSession(updated[0]) });
}));

module.exports = router;
module.exports.publicUser = publicUser;
