"use strict";
const express = require("express");
const { query } = require("../db");
const { ApiError, asyncHandler } = require("../middleware/errorHandler");
const { requireAuth } = require("../middleware/auth");
const { assertCanViewUser } = require("../services/accessPolicy");

const router = express.Router();

function shapeBaby(row, includeBirthday = true) {
  let interests = row.interests;
  if (typeof interests === "string") {
    try { interests = JSON.parse(interests); } catch (e) { interests = []; }
  }
  if (!Array.isArray(interests)) interests = [];
  let birthday = row.birthday;
  if (birthday instanceof Date) {
    birthday = birthday.toISOString().slice(0, 10);
  }
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    nickname: row.nickname,
    birthday: includeBirthday ? birthday : null,
    gender: row.gender,
    interests: interests,
  };
}

// 我的宝宝列表: GET /babies/mine
router.get("/mine", requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query("SELECT * FROM babies WHERE owner_id = $1 ORDER BY created_at", [req.userId]);
  res.json({ ok: true, data: { items: rows.map(shapeBaby) } });
}));

// 指定用户的宝宝: GET /babies?userId=123
router.get("/", requireAuth, asyncHandler(async (req, res) => {
  const target = String(req.query.userId || req.userId);
  await assertCanViewUser(req.userId, target);
  const { rows } = await query(
    `SELECT b.*, u.show_baby_age
     FROM babies b
     JOIN users u ON u.id = b.owner_id
     WHERE b.owner_id = $1
     ORDER BY b.created_at`,
    [target]
  );
  const isOwner = String(target) === String(req.userId);
  res.json({
    ok: true,
    data: {
      items: rows.map((row) => shapeBaby(row, isOwner || row.show_baby_age !== false)),
    },
  });
}));

// 批量读取好友宝宝资料，避免客户端逐好友请求造成 N+1。
router.get("/friends", requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT b.*, u.show_baby_age FROM babies b
     JOIN users u ON u.id = b.owner_id
     JOIN friendships f
       ON f.user_a_id = LEAST($1::bigint, b.owner_id)
      AND f.user_b_id = GREATEST($1::bigint, b.owner_id)
     WHERE (f.user_a_id = $1 OR f.user_b_id = $1)
       AND NOT EXISTS (
         SELECT 1 FROM user_blocks blocked
         WHERE (blocked.user_id = $1 AND blocked.blocked_id = b.owner_id)
            OR (blocked.user_id = b.owner_id AND blocked.blocked_id = $1)
       )
     ORDER BY b.owner_id, b.created_at`,
    [req.userId]
  );
  res.json({
    ok: true,
    data: { items: rows.map((row) => shapeBaby(row, row.show_baby_age !== false)) },
  });
}));

// 添加宝宝: POST /babies  body { nickname, birthday, gender, interests }
router.post("/", requireAuth, asyncHandler(async (req, res) => {
  const nickname = String(req.body.nickname || "").trim();
  const birthday = String(req.body.birthday || "").trim();
  let gender = parseInt(req.body.gender, 10);
  if (![0, 1, 2].includes(gender)) gender = 2;
  let interests = req.body.interests;
  if (!Array.isArray(interests)) interests = [];
  if (!nickname) throw new ApiError(400, "请填写宝宝昵称", "NO_NICKNAME");
  if (!birthday) throw new ApiError(400, "请填写宝宝生日", "NO_BIRTHDAY");
  if (nickname.length > 32) throw new ApiError(400, "宝宝昵称不能超过 32 个字符", "NICKNAME_TOO_LONG");
  if (interests.length > 20 || interests.some((item) => typeof item !== "string" || item.trim().length > 30)) {
    throw new ApiError(400, "兴趣标签格式不正确", "BAD_INTERESTS");
  }
  const parsedBirthday = new Date(`${birthday}T00:00:00.000Z`);
  if (Number.isNaN(parsedBirthday.getTime()) || parsedBirthday > new Date()) {
    throw new ApiError(400, "宝宝生日格式不正确", "BAD_BIRTHDAY");
  }
  const { rows } = await query(
    "INSERT INTO babies (owner_id, nickname, birthday, gender, interests) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [req.userId, nickname, birthday, gender, JSON.stringify(interests.map((item) => item.trim()))]
  );
  res.json({ ok: true, data: shapeBaby(rows[0]) });
}));

module.exports = router;
