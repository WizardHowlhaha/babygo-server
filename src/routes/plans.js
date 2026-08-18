'use strict';
const express = require('express');
const { query, withTransaction } = require('../db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { isContentSafe } = require('../utils/validators');
const { assertCanViewPlan, getUserRelationship } = require('../services/accessPolicy');
const { approximateCoordinate, distanceMeters, shapePlan } = require('../services/planPrivacy');
const { requirePositiveIntegerParam } = require('../middleware/validateRequest');

const router = express.Router();
router.param('id', requirePositiveIntegerParam('id'));

// 发布活动: POST /plans
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const title = String(req.body.title || '').trim();
  const summary = String(req.body.summary || '').trim();
  const startsAt = req.body.startsAt;
  const duration = req.body.durationMinutes ?? 60;
  const limit = req.body.participantLimit ?? 4;
  const approx = String(req.body.approximatePlace || '').trim();
  const priv = String(req.body.privateMeetingPoint || '').trim();
  const lat = Number(req.body.latitude);
  const lng = Number(req.body.longitude);
  const visibility = req.body.visibility ?? 0;
  const rawInvitees = req.body.invitedUserIds ?? [];
  if (!Array.isArray(rawInvitees)) {
    throw new ApiError(400, '邀请名单格式不正确', 'BAD_INVITEES');
  }
  const invitedUserIds = Array.from(new Set(rawInvitees.map(String)));

  if (!title) throw new ApiError(400, '请填写活动标题', 'EMPTY_TITLE');
  if (![0, 1].includes(visibility)) throw new ApiError(400, '活动可见范围不正确', 'BAD_VISIBILITY');
  if (title.length > 50) throw new ApiError(400, '标题不能超过 50 字', 'TITLE_TOO_LONG');
  if (summary.length > 500) throw new ApiError(400, '活动介绍不能超过 500 字', 'SUMMARY_TOO_LONG');
  if (typeof startsAt !== 'string' || Number.isNaN(Date.parse(startsAt)) || new Date(startsAt) <= new Date()) {
    throw new ApiError(400, '请选择未来的开始时间', 'BAD_TIME');
  }
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 30 || duration > 360) {
    throw new ApiError(400, '活动时长需在 30-360 分钟之间', 'BAD_DURATION');
  }
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 2 || limit > 20) {
    throw new ApiError(400, '人数上限需在 2-20 之间', 'BAD_LIMIT');
  }
  if (!approx || approx.length > 100) throw new ApiError(400, '请填写 100 字以内的大致区域', 'BAD_PLACE');
  if (!priv || priv.length > 200) throw new ApiError(400, '请填写 200 字以内的准确集合点', 'BAD_PRIVATE_PLACE');
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new ApiError(400, '发布附近活动需要有效定位', 'BAD_LOCATION');
  }
  if (
    invitedUserIds.some((id) => !/^[1-9]\d*$/.test(id) || id === String(req.userId)) ||
    invitedUserIds.length > 20
  ) {
    throw new ApiError(400, '邀请名单包含无效用户', 'BAD_INVITEES');
  }
  if (!isContentSafe(title) || !isContentSafe(summary) || !isContentSafe(approx) || !isContentSafe(priv)) {
    throw new ApiError(400, '内容可能包含联系方式或不适宜信息，请修改后再发布', 'BLOCKED_CONTENT');
  }

  const plan = await withTransaction(async (client) => {
    if (invitedUserIds.length > 0) {
      for (const targetUserId of invitedUserIds) {
        const relationship = await getUserRelationship(req.userId, targetUserId, client);
        if (!relationship?.target_exists || !relationship.are_friends || relationship.is_blocked) {
          throw new ApiError(400, '只能邀请当前好友', 'INVALID_INVITEE');
        }
      }
    }

    const { rows } = await client.query(
      `INSERT INTO walk_plans
        (owner_id,title,summary,starts_at,duration_minutes,participant_limit,approximate_place,geo,private_meeting_point,visibility,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,ST_SetSRID(ST_MakePoint($8,$9),4326)::geography,$10,$11,1)
        RETURNING *`,
      [req.userId, title, summary, startsAt, duration, limit, approx, lng, lat, priv, visibility]
    );
    await client.query('INSERT INTO plan_members (plan_id,user_id,status) VALUES ($1,$2,2)', [rows[0].id, req.userId]);
    if (invitedUserIds.length > 0) {
      await client.query(
        `INSERT INTO plan_members (plan_id, user_id, status)
         SELECT $1, invited_id, 0 FROM unnest($2::bigint[]) AS invited_id`,
        [rows[0].id, invitedUserIds]
      );
    }
    return rows[0];
  });

  const { rows } = await query(
    `SELECT wp.*, ST_Y(wp.geo::geometry) AS latitude, ST_X(wp.geo::geometry) AS longitude,
            u.nickname, u.avatar, u.is_verified, 2 AS my_member_status,
            1 AS accepted_count
     FROM walk_plans wp JOIN users u ON u.id = wp.owner_id WHERE wp.id = $1`, [plan.id]
  );
  res.json({ ok: true, data: shapePlan(rows[0], req.userId, true) });
}));

// 附近活动发现: GET /plans/nearby?lat=&lng=&radius=(米,默认5000)&limit=
router.get('/nearby', requireAuth, asyncHandler(async (req, res) => {
  const me = req.userId;
  const { rows: settings } = await query(
    'SELECT allow_nearby_discovery FROM users WHERE id = $1',
    [me]
  );
  if (settings[0]?.allow_nearby_discovery === false) {
    throw new ApiError(403, '附近活动发现已关闭', 'NEARBY_DISCOVERY_DISABLED');
  }
  const lat = Number.parseFloat(req.query.lat);
  const lng = Number.parseFloat(req.query.lng);
  const parsedRadius = Number.parseInt(req.query.radius || '5000', 10);
  const parsedLimit = Number.parseInt(req.query.limit || '30', 10);
  const radius = Number.isInteger(parsedRadius) ? Math.min(Math.max(parsedRadius, 100), 50000) : 5000;
  const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 30;
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new ApiError(400, '缺少有效定位坐标', 'NO_LOCATION');
  }

  const point = 'ST_SetSRID(ST_MakePoint($2,$3),4326)::geography';
  const sql = `
    SELECT wp.*, ST_Y(wp.geo::geometry) AS latitude, ST_X(wp.geo::geometry) AS longitude,
           u.nickname, u.avatar, u.is_verified,
           ST_Distance(wp.geo, ${point}) AS distance_meters,
           (SELECT COUNT(*) FROM plan_members pm WHERE pm.plan_id = wp.id AND pm.status = 2) AS accepted_count,
           (SELECT pm2.status FROM plan_members pm2 WHERE pm2.plan_id = wp.id AND pm2.user_id = $1) AS my_member_status
    FROM walk_plans wp
    JOIN users u ON u.id = wp.owner_id
    WHERE wp.status = 1
      AND wp.geo IS NOT NULL
      AND wp.starts_at > NOW()
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks b
        WHERE (b.user_id = $1 AND b.blocked_id = wp.owner_id)
           OR (b.user_id = wp.owner_id AND b.blocked_id = $1)
      )
      AND (
        wp.visibility = 0
        OR wp.owner_id = $1
        OR EXISTS (
          SELECT 1 FROM friendships f
          WHERE f.user_a_id = LEAST($1::bigint, wp.owner_id)
            AND f.user_b_id = GREATEST($1::bigint, wp.owner_id)
        )
        OR EXISTS (
          SELECT 1 FROM plan_members visible_pm
          WHERE visible_pm.plan_id = wp.id AND visible_pm.user_id = $1
        )
      )
      AND ST_DWithin(wp.geo, ${point}, $4 + 2000)
    ORDER BY distance_meters ASC
    LIMIT LEAST($5 * 4, 200)`;
  const { rows } = await query(sql, [me, lng, lat, radius, limit]);
  const items = rows.flatMap((row) => {
    const canSeePrivateLocation = row.my_member_status === 2 || String(row.owner_id) === String(me);
    if (canSeePrivateLocation) return [shapePlan(row, me, true)];
    const coordinate = approximateCoordinate(row.id, row.latitude, row.longitude);
    if (!coordinate) return [];
    const publicDistance = distanceMeters(lat, lng, coordinate.latitude, coordinate.longitude);
    if (publicDistance > radius) return [];
    return [shapePlan({ ...row, distance_meters: publicDistance }, me, false)];
  }).slice(0, limit);
  res.json({ ok: true, data: { items } });
}));

// 我参与/发起的活动: GET /plans/mine
router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const me = req.userId;
  const sql = `
    SELECT wp.*, ST_Y(wp.geo::geometry) AS latitude, ST_X(wp.geo::geometry) AS longitude,
           u.nickname, u.avatar, u.is_verified,
           (SELECT COUNT(*) FROM plan_members pm WHERE pm.plan_id = wp.id AND pm.status = 2) AS accepted_count,
           pmine.status AS my_member_status
    FROM walk_plans wp
    JOIN users u ON u.id = wp.owner_id
    JOIN plan_members pmine ON pmine.plan_id = wp.id AND pmine.user_id = $1
    WHERE wp.status = 1
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks blocked
        WHERE (blocked.user_id = $1 AND blocked.blocked_id = wp.owner_id)
           OR (blocked.user_id = wp.owner_id AND blocked.blocked_id = $1)
      )
    ORDER BY wp.starts_at DESC`;
  const { rows } = await query(sql, [me]);
  const items = rows.map((r) => shapePlan(r, me, r.my_member_status === 2));
  res.json({ ok: true, data: { items } });
}));

// 活动详情 + 成员列表
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const me = req.userId;
  await assertCanViewPlan(me, req.params.id);
  const { rows } = await query(
    `SELECT wp.*, ST_Y(wp.geo::geometry) AS latitude, ST_X(wp.geo::geometry) AS longitude,
            u.nickname, u.avatar, u.is_verified,
            (SELECT COUNT(*) FROM plan_members pm WHERE pm.plan_id = wp.id AND pm.status = 2) AS accepted_count,
            (SELECT pm2.status FROM plan_members pm2 WHERE pm2.plan_id = wp.id AND pm2.user_id = $2) AS my_member_status
     FROM walk_plans wp JOIN users u ON u.id = wp.owner_id WHERE wp.id = $1`, [req.params.id, me]
  );
  if (!rows[0] || rows[0].status !== 1) throw new ApiError(404, '活动不存在', 'NOT_FOUND');
  const plan = rows[0];
  const isMember = plan.my_member_status === 2 || String(plan.owner_id) === String(me);
  const isOwner = String(plan.owner_id) === String(me);
  const members = isOwner || isMember
    ? (await query(
      `SELECT pm.status, pm.created_at, u.id, u.nickname, u.avatar, u.is_verified
       FROM plan_members pm JOIN users u ON u.id = pm.user_id
       WHERE pm.plan_id = $1
         AND ($2::boolean OR pm.status = 2)
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks blocked
           WHERE (blocked.user_id = $3 AND blocked.blocked_id = pm.user_id)
              OR (blocked.user_id = pm.user_id AND blocked.blocked_id = $3)
         )
       ORDER BY pm.status DESC, pm.created_at ASC`,
      [req.params.id, isOwner, me]
    )).rows
    : [];
  res.json({
    ok: true,
    data: {
      plan: shapePlan(plan, me, isMember),
      members: members.map((m) => ({
        id: String(m.id), nickname: m.nickname, avatar: m.avatar,
        isVerified: m.is_verified, status: m.status,
      })),
    },
  });
}));

// 申请加入: POST /plans/:id/apply
router.post('/:id/apply', requireAuth, asyncHandler(async (req, res) => {
  const planId = req.params.id;
  const me = req.userId;
  const result = await withTransaction(async (client) => {
    await assertCanViewPlan(me, planId, client);
    // 行锁, 防并发超员
    const { rows } = await client.query('SELECT * FROM walk_plans WHERE id = $1 FOR UPDATE', [planId]);
    const plan = rows[0];
    if (!plan || plan.status !== 1) throw new ApiError(404, '活动不存在', 'NOT_FOUND');
    if (String(plan.owner_id) === String(me)) throw new ApiError(400, '你是活动发起人', 'IS_OWNER');
    const { rows: exist } = await client.query('SELECT status FROM plan_members WHERE plan_id = $1 AND user_id = $2', [planId, me]);
    if (exist[0]) {
      if (exist[0].status === 2) throw new ApiError(409, '你已加入该活动', 'ALREADY_MEMBER');
      if (exist[0].status === 1) throw new ApiError(409, '申请已提交, 请等待通过', 'ALREADY_APPLIED');
      if (exist[0].status === 0) throw new ApiError(409, '你有待处理的活动邀请', 'INVITATION_PENDING');
    }
    const { rows: cnt } = await client.query('SELECT COUNT(*)::int AS n FROM plan_members WHERE plan_id = $1 AND status = 2', [planId]);
    if (cnt[0].n >= plan.participant_limit) throw new ApiError(409, '活动人数已满', 'PLAN_FULL');
    // status=1 申请中(等活动主审核)
    await client.query(
      `INSERT INTO plan_members (plan_id,user_id,status) VALUES ($1,$2,1)
       ON CONFLICT (plan_id,user_id) DO UPDATE SET status = 1`, [planId, me]
    );
    return { status: 1 };
  });
  res.json({ ok: true, data: { memberStatus: result.status } });
}));

// 邀请回应: POST /plans/:id/respond  body { accept: true|false }  (被邀请者操作, status 0 -> 2/删除)
router.post('/:id/respond', requireAuth, asyncHandler(async (req, res) => {
  const planId = req.params.id;
  const me = req.userId;
  const accept = req.body.accept === true;
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM walk_plans WHERE id = $1 FOR UPDATE', [planId]);
    const plan = rows[0];
    if (!plan || plan.status !== 1) throw new ApiError(404, '活动不存在', 'NOT_FOUND');
    const { rows: mem } = await client.query('SELECT status FROM plan_members WHERE plan_id = $1 AND user_id = $2', [planId, me]);
    if (!mem[0] || mem[0].status !== 0) throw new ApiError(404, '没有待处理的邀请', 'NO_INVITE');
    if (!accept) {
      await client.query('DELETE FROM plan_members WHERE plan_id = $1 AND user_id = $2', [planId, me]);
      return;
    }
    const { rows: cnt } = await client.query('SELECT COUNT(*)::int AS n FROM plan_members WHERE plan_id = $1 AND status = 2', [planId]);
    if (cnt[0].n >= plan.participant_limit) throw new ApiError(409, '活动人数已满', 'PLAN_FULL');
    await client.query('UPDATE plan_members SET status = 2 WHERE plan_id = $1 AND user_id = $2', [planId, me]);
  });
  res.json({ ok: true, data: { memberStatus: accept ? 2 : null } });
}));

// 活动主审核申请: POST /plans/:id/review  body { userId, approve: true|false }
router.post('/:id/review', requireAuth, asyncHandler(async (req, res) => {
  const planId = req.params.id;
  const targetUser = String(req.body.userId || '');
  const approve = req.body.approve === true;
  if (!targetUser) throw new ApiError(400, '缺少申请人', 'NO_USER');
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM walk_plans WHERE id = $1 FOR UPDATE', [planId]);
    const plan = rows[0];
    if (!plan || plan.status !== 1) throw new ApiError(404, '活动不存在', 'NOT_FOUND');
    if (String(plan.owner_id) !== String(req.userId)) throw new ApiError(403, '只有发起人可以审核', 'FORBIDDEN');
    const { rows: mem } = await client.query('SELECT status FROM plan_members WHERE plan_id = $1 AND user_id = $2', [planId, targetUser]);
    if (!mem[0] || mem[0].status !== 1) throw new ApiError(404, '没有待审核的申请', 'NO_APPLICATION');
    if (!approve) {
      await client.query('DELETE FROM plan_members WHERE plan_id = $1 AND user_id = $2', [planId, targetUser]);
      return;
    }
    const { rows: cnt } = await client.query('SELECT COUNT(*)::int AS n FROM plan_members WHERE plan_id = $1 AND status = 2', [planId]);
    if (cnt[0].n >= plan.participant_limit) throw new ApiError(409, '活动人数已满', 'PLAN_FULL');
    await client.query('UPDATE plan_members SET status = 2 WHERE plan_id = $1 AND user_id = $2', [planId, targetUser]);
  });
  res.json({ ok: true });
}));

// 邀请好友加入: POST /plans/:id/invite  body { userId }  (活动主操作, 生成 status 0 记录)
router.post('/:id/invite', requireAuth, asyncHandler(async (req, res) => {
  const planId = req.params.id;
  const targetUser = String(req.body.userId || '');
  if (!targetUser) throw new ApiError(400, '缺少被邀请人', 'NO_USER');
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT owner_id, status FROM walk_plans WHERE id = $1 FOR UPDATE', [planId]);
    if (!rows[0] || rows[0].status !== 1) throw new ApiError(404, '活动不存在', 'NOT_FOUND');
    if (String(rows[0].owner_id) !== String(req.userId)) throw new ApiError(403, '只有发起人可以邀请', 'FORBIDDEN');
    const relationship = await getUserRelationship(req.userId, targetUser, client);
    if (!relationship?.target_exists || !relationship.are_friends || relationship.is_blocked) {
      throw new ApiError(400, '只能邀请当前好友', 'INVALID_INVITEE');
    }
    const existing = await client.query(
      'SELECT status FROM plan_members WHERE plan_id = $1 AND user_id = $2',
      [planId, targetUser]
    );
    if (existing.rows[0]) throw new ApiError(409, '该用户已在活动名单中', 'ALREADY_INVITED');
    await client.query(
      'INSERT INTO plan_members (plan_id,user_id,status) VALUES ($1,$2,0)',
      [planId, targetUser]
    );
  });
  res.json({ ok: true });
}));

// 取消活动 (发起人, 软删除)
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT owner_id FROM walk_plans WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw new ApiError(404, '活动不存在', 'NOT_FOUND');
  if (String(rows[0].owner_id) !== String(req.userId)) throw new ApiError(403, '只有发起人可以取消', 'FORBIDDEN');
  await query('UPDATE walk_plans SET status = 2 WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
