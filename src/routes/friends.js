'use strict';
const express = require('express');
const { query, withTransaction } = require('../db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { getUserRelationship } = require('../services/accessPolicy');
const { requirePositiveIntegerParam } = require('../middleware/validateRequest');

const router = express.Router();
router.param('id', requirePositiveIntegerParam('id'));
router.param('userId', requirePositiveIntegerParam('userId'));

function pubUser(row) {
  return {
    id: String(row.id),
    nickname: row.nickname,
    avatar: row.avatar,
    bio: row.bio,
    city: row.city,
    isVerified: row.is_verified,
  };
}

// 好友列表: GET /friends
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const me = req.userId;
  const sql = `
    SELECT u.* FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.user_a_id = $1 THEN f.user_b_id ELSE f.user_a_id END
    WHERE f.user_a_id = $1 OR f.user_b_id = $1
    ORDER BY u.nickname`;
  const { rows } = await query(sql, [me]);
  res.json({ ok: true, data: { items: rows.map(pubUser) } });
}));

// 收到的好友请求: GET /friends/requests
router.get('/requests', requireAuth, asyncHandler(async (req, res) => {
  const me = req.userId;
  const { rows } = await query(
    `SELECT fr.id, fr.status, fr.created_at, u.id AS uid, u.nickname, u.avatar, u.bio, u.city, u.is_verified
     FROM friend_requests fr JOIN users u ON u.id = fr.sender_id
     WHERE fr.receiver_id = $1 AND fr.status = 0
     ORDER BY fr.created_at DESC`, [me]
  );
  const items = rows.map((r) => ({
    requestId: String(r.id),
    createdAt: r.created_at,
    from: pubUser({ id: r.uid, nickname: r.nickname, avatar: r.avatar, bio: r.bio, city: r.city, is_verified: r.is_verified }),
  }));
  res.json({ ok: true, data: { items } });
}));

// 发送好友请求: POST /friends/requests  body { userId }
router.post('/requests', requireAuth, asyncHandler(async (req, res) => {
  const me = req.userId;
  const target = String(req.body.userId || '');
  if (!/^[1-9]\d*$/.test(target)) throw new ApiError(400, '缺少有效目标用户', 'NO_USER');
  if (target === String(me)) throw new ApiError(400, '不能添加自己', 'SELF');
  const requestId = await withTransaction(async (client) => {
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtextextended(
           LEAST($1::bigint, $2::bigint)::text || ':' || GREATEST($1::bigint, $2::bigint)::text,
           0
         )
       )`,
      [me, target]
    );
    const relationship = await getUserRelationship(me, target, client);
    if (!relationship?.target_exists) throw new ApiError(404, '用户不存在', 'USER_NOT_FOUND');
    if (relationship.are_friends) throw new ApiError(409, '你们已经是好友', 'ALREADY_FRIENDS');
    if (relationship.is_blocked) throw new ApiError(403, '无法发送请求', 'BLOCKED');
    const { rows: targetSettings } = await client.query(
      'SELECT allow_friend_requests FROM users WHERE id = $1',
      [target]
    );
    if (targetSettings[0]?.allow_friend_requests === false) {
      throw new ApiError(403, '对方暂不接受好友申请', 'FRIEND_REQUESTS_DISABLED');
    }

    const { rows: reversePending } = await client.query(
      `SELECT id FROM friend_requests
       WHERE sender_id = $1 AND receiver_id = $2 AND status = 0
       FOR UPDATE`,
      [target, me]
    );
    if (reversePending[0]) {
      throw new ApiError(409, '对方已向你发送好友请求，请先处理', 'REVERSE_REQUEST_PENDING');
    }

    const existing = await client.query(
      `SELECT id FROM friend_requests
       WHERE sender_id = $1 AND receiver_id = $2 AND status = 0
       FOR UPDATE`,
      [me, target]
    );
    if (existing.rows[0]) return String(existing.rows[0].id);
    try {
      const { rows } = await client.query(
        `INSERT INTO friend_requests (sender_id, receiver_id, status)
         VALUES ($1,$2,0)
         RETURNING id`,
        [me, target]
      );
      return String(rows[0].id);
    } catch (error) {
      if (error?.code !== '23505') throw error;
      const { rows } = await client.query(
        `SELECT id FROM friend_requests
         WHERE sender_id = $1 AND receiver_id = $2 AND status = 0`,
        [me, target]
      );
      return String(rows[0].id);
    }
  });
  res.json({ ok: true, data: { requestId } });
}));

// 处理好友请求: POST /friends/requests/:id/respond  body { accept: true|false }
router.post('/requests/:id/respond', requireAuth, asyncHandler(async (req, res) => {
  const me = req.userId;
  const accept = req.body.accept === true;
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM friend_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
    const fr = rows[0];
    if (!fr || fr.status !== 0) throw new ApiError(404, '请求不存在或已处理', 'NOT_FOUND');
    if (String(fr.receiver_id) !== String(me)) throw new ApiError(403, '无权处理该请求', 'FORBIDDEN');
    await client.query('UPDATE friend_requests SET status = $2 WHERE id = $1', [fr.id, accept ? 1 : 2]);
    if (accept) {
      await client.query(
        `INSERT INTO friendships (user_a_id, user_b_id)
         VALUES (LEAST($1::bigint, $2::bigint), GREATEST($1::bigint, $2::bigint))
         ON CONFLICT DO NOTHING`,
        [fr.sender_id, fr.receiver_id]
      );
    }
  });
  res.json({ ok: true });
}));

// 拉黑用户: POST /friends/block  body { userId }
router.post('/block', requireAuth, asyncHandler(async (req, res) => {
  const me = req.userId;
  const target = String(req.body.userId || '');
  if (!/^[1-9]\d*$/.test(target) || target === String(me)) {
    throw new ApiError(400, '参数错误', 'BAD_TARGET');
  }
  await withTransaction(async (client) => {
    const relationship = await getUserRelationship(me, target, client);
    if (!relationship?.target_exists) throw new ApiError(404, '用户不存在', 'USER_NOT_FOUND');
    await client.query(
      'INSERT INTO user_blocks (user_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [me, target]
    );
    // 拉黑后解除好友关系
    await client.query(
      `DELETE FROM friendships
       WHERE user_a_id = LEAST($1::bigint, $2::bigint)
         AND user_b_id = GREATEST($1::bigint, $2::bigint)`,
      [me, target]
    );
    await client.query(
      `DELETE FROM friend_requests
       WHERE status = 0
         AND ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))`,
      [me, target]
    );
    await client.query(
      `DELETE FROM plan_members pm
       USING walk_plans wp
       WHERE pm.plan_id = wp.id
         AND (
           (wp.owner_id = $1 AND pm.user_id = $2)
           OR (wp.owner_id = $2 AND pm.user_id = $1)
         )`,
      [me, target]
    );
  });
  res.json({ ok: true });
}));

// 取消拉黑: DELETE /friends/block/:userId
router.delete('/block/:userId', requireAuth, asyncHandler(async (req, res) => {
  await query('DELETE FROM user_blocks WHERE user_id = $1 AND blocked_id = $2', [req.userId, req.params.userId]);
  res.json({ ok: true });
}));

// 举报: POST /friends/report  body { targetType, targetId, reason }
// targetType: 0动态 1评论 2用户 3活动
router.post('/report', requireAuth, asyncHandler(async (req, res) => {
  const targetType = parseInt(req.body.targetType, 10);
  const targetId = String(req.body.targetId || '');
  const reason = parseInt(req.body.reason, 10);
  if (![0, 1, 2, 3].includes(targetType) || !/^[1-9]\d*$/.test(targetId) || ![0, 1, 2, 3].includes(reason)) {
    throw new ApiError(400, '举报参数不完整', 'BAD_REPORT');
  }
  const targetTables = ['posts', 'comments', 'users', 'walk_plans'];
  const targetTable = targetTables[targetType];
  const statusClause = targetType === 0 || targetType === 1 || targetType === 3 ? ' AND status = 1' : '';
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT 1 FROM ${targetTable} WHERE id = $1${statusClause}`,
      [targetId]
    );
    if (!rows[0]) throw new ApiError(404, '举报对象不存在', 'TARGET_NOT_FOUND');
    await client.query(
      'INSERT INTO reports (reporter_id, target_type, target_id, reason) VALUES ($1,$2,$3,$4)',
      [req.userId, targetType, targetId, reason]
    );
  });
  res.json({ ok: true });
}));

module.exports = router;
