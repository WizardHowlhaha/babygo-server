'use strict';
const express = require('express');
const { query, withTransaction } = require('../db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { isContentSafe } = require('../utils/validators');
const { assertCanViewPost } = require('../services/accessPolicy');
const config = require('../config');
const mediaService = require('../services/mediaService');
const { requirePositiveIntegerParam } = require('../middleware/validateRequest');

const router = express.Router();
router.param('id', requirePositiveIntegerParam('id'));
const ALLOWED_MEDIA_TYPES = new Set(['image', 'video']);

function validateMedia(items, userId) {
  if (items.length > 9) {
    throw new ApiError(400, '单条动态最多包含 9 个媒体文件', 'TOO_MANY_MEDIA');
  }
  return items.map((item) => {
    if (!item || typeof item !== 'object' || !ALLOWED_MEDIA_TYPES.has(item.type)) {
      throw new ApiError(400, '媒体信息格式不正确', 'BAD_MEDIA');
    }
    const url = trustedMediaUrl(item.url, userId);
    const cover = item.cover ? trustedMediaUrl(item.cover, userId) : undefined;
    return {
      type: item.type,
      url,
      cover,
      width: Number.isInteger(item.width) && item.width > 0 ? item.width : undefined,
      height: Number.isInteger(item.height) && item.height > 0 ? item.height : undefined,
      duration: Number.isFinite(item.duration) && item.duration >= 0 ? item.duration : undefined,
    };
  });
}

function trustedMediaUrl(rawUrl, userId) {
  const url = String(rawUrl || '');
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new ApiError(400, '媒体地址格式不正确', 'BAD_MEDIA_URL');
  }
  if (
    parsed.protocol !== 'https:' ||
    !mediaService.available() ||
    parsed.origin !== new URL(config.oss.publicBaseUrl).origin
  ) {
    throw new ApiError(400, '媒体地址不受信任', 'UNTRUSTED_MEDIA_URL');
  }
  if (!parsed.pathname.startsWith(`/uploads/${userId}/`)) {
    throw new ApiError(403, '不能发布他人的媒体文件', 'MEDIA_FORBIDDEN');
  }
  return url;
}

function shapePost(row, meId) {
  let visibleUserIds = row.visible_user_ids;
  if (typeof visibleUserIds === 'string') {
    try { visibleUserIds = JSON.parse(visibleUserIds); } catch (error) { visibleUserIds = []; }
  }
  return {
    id: String(row.id),
    author: {
      id: String(row.author_id),
      nickname: row.nickname,
      avatar: row.avatar,
      isVerified: row.is_verified,
    },
    content: row.content,
    media: row.media,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    liked: row.liked === true,
    visibility: row.visibility,
    visibleUserIds: Array.isArray(visibleUserIds) ? visibleUserIds.map(String) : [],
    createdAt: row.created_at,
    isMine: String(row.author_id) === String(meId),
  };
}

function parseAudience(body) {
  const visibility = body.visibility ?? 0;
  if (![0, 1, 2, 3].includes(visibility)) {
    throw new ApiError(400, '动态可见范围不正确', 'BAD_VISIBILITY');
  }
  const rawUserIds = body.visibleUserIds ?? [];
  if (!Array.isArray(rawUserIds)) {
    throw new ApiError(400, '指定可见好友格式不正确', 'BAD_VISIBLE_USERS');
  }
  const visibleUserIds = Array.from(new Set(rawUserIds.map(String)));
  if (visibleUserIds.some((id) => !/^[1-9]\d*$/.test(id))) {
    throw new ApiError(400, '指定可见好友包含无效用户', 'BAD_VISIBLE_USERS');
  }
  if (visibility === 3 && visibleUserIds.length === 0) {
    throw new ApiError(400, '请至少选择一位可见好友', 'VISIBLE_USERS_REQUIRED');
  }
  if (visibility !== 3 && visibleUserIds.length > 0) {
    throw new ApiError(400, '当前可见范围不能指定好友', 'UNEXPECTED_VISIBLE_USERS');
  }
  if (visibleUserIds.length > 100) {
    throw new ApiError(400, '单条动态最多指定 100 位好友', 'TOO_MANY_VISIBLE_USERS');
  }
  return { visibility, visibleUserIds };
}

async function assertSelectedUsersAreFriends(client, ownerId, visibleUserIds) {
  if (visibleUserIds.length === 0) return;
  const { rows } = await client.query(
    `SELECT u.id,
            EXISTS(
              SELECT 1 FROM friendships f
              WHERE f.user_a_id = LEAST($1::bigint, u.id)
                AND f.user_b_id = GREATEST($1::bigint, u.id)
            ) AS are_friends,
            EXISTS(
              SELECT 1 FROM user_blocks b
              WHERE (b.user_id = $1 AND b.blocked_id = u.id)
                 OR (b.user_id = u.id AND b.blocked_id = $1)
            ) AS is_blocked
     FROM users u
     WHERE u.id = ANY($2::bigint[])`,
    [ownerId, visibleUserIds]
  );
  if (
    rows.length !== visibleUserIds.length ||
    rows.some((row) => !row.are_friends || row.is_blocked)
  ) {
    throw new ApiError(400, '只能指定当前好友查看动态', 'INVALID_VISIBLE_USERS');
  }
}

// 动态流 (游标分页): GET /posts/feed?cursor=<ISO时间>&limit=20
router.get('/feed', requireAuth, asyncHandler(async (req, res) => {
  const me = req.userId;
  const parsedLimit = Number.parseInt(req.query.limit || '20', 10);
  const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 20;
  const cursor = req.query.cursor; // 上一页最后一条的 created_at
  if (cursor && Number.isNaN(Date.parse(cursor))) {
    throw new ApiError(400, '分页游标格式不正确', 'BAD_CURSOR');
  }
  const params = [me];
  let cursorClause = '';
  if (cursor) { params.push(cursor); cursorClause = `AND p.created_at < $${params.length}`; }
  params.push(limit);

  const sql = `
    SELECT p.*, u.nickname, u.avatar, u.is_verified,
           EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = $1) AS liked,
           '[]'::json AS visible_user_ids
    FROM posts p
    JOIN users u ON u.id = p.author_id
    WHERE p.status = 1
      AND NOT EXISTS (
        SELECT 1 FROM user_blocks b
        WHERE (b.user_id = $1 AND b.blocked_id = p.author_id)
           OR (b.user_id = p.author_id AND b.blocked_id = $1)
      )
      AND (
        p.visibility = 0
        OR p.author_id = $1
        OR (p.visibility = 1 AND EXISTS (
          SELECT 1 FROM friendships f
          WHERE f.user_a_id = LEAST($1::bigint, p.author_id)
            AND f.user_b_id = GREATEST($1::bigint, p.author_id)
        ))
        OR (p.visibility = 3 AND EXISTS (
          SELECT 1 FROM post_visible_users pvu
          WHERE pvu.post_id = p.id AND pvu.user_id = $1
        ))
      )
      ${cursorClause}
    ORDER BY p.created_at DESC
    LIMIT $${params.length}`;
  const { rows } = await query(sql, params);
  const items = rows.map((r) => shapePost(r, me));
  const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null;
  res.json({ ok: true, data: { items, nextCursor } });
}));

// 当前用户动态: GET /posts/mine?cursor=<ISO时间>&limit=20
router.get('/mine', requireAuth, asyncHandler(async (req, res) => {
  const parsedLimit = Number.parseInt(req.query.limit || '20', 10);
  const limit = Number.isInteger(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 20;
  const cursor = req.query.cursor;
  if (cursor && Number.isNaN(Date.parse(cursor))) {
    throw new ApiError(400, '分页游标格式不正确', 'BAD_CURSOR');
  }

  const params = [req.userId];
  let cursorClause = '';
  if (cursor) {
    params.push(cursor);
    cursorClause = `AND p.created_at < $${params.length}`;
  }
  params.push(limit);

  const { rows } = await query(
    `SELECT p.*, u.nickname, u.avatar, u.is_verified,
            EXISTS(
              SELECT 1 FROM post_likes pl
              WHERE pl.post_id = p.id AND pl.user_id = $1
            ) AS liked,
            COALESCE(
              (
                SELECT json_agg(pvu.user_id::text ORDER BY pvu.user_id)
                FROM post_visible_users pvu
                WHERE pvu.post_id = p.id
              ),
              '[]'::json
            ) AS visible_user_ids
     FROM posts p
     JOIN users u ON u.id = p.author_id
     WHERE p.author_id = $1
       AND p.status = 1
       ${cursorClause}
     ORDER BY p.created_at DESC
     LIMIT $${params.length}`,
    params
  );
  const items = rows.map((row) => shapePost(row, req.userId));
  const nextCursor = rows.length === limit ? rows[rows.length - 1].created_at : null;
  res.json({ ok: true, data: { items, nextCursor } });
}));

// 发布动态: POST /posts { content, media?, visibility? }
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const content = String(req.body.content || '').trim();
  const rawMedia = Array.isArray(req.body.media) ? req.body.media : [];
  const media = validateMedia(rawMedia, req.userId);
  const { visibility, visibleUserIds } = parseAudience(req.body);
  if (!content && media.length === 0) throw new ApiError(400, '请输入内容或选择图片/视频', 'EMPTY_POST');
  if (content.length > 500) throw new ApiError(400, '文字不能超过 500 字', 'CONTENT_TOO_LONG');
  if (!isContentSafe(content)) throw new ApiError(400, '内容可能包含联系方式或不适宜信息，请修改后再发布', 'BLOCKED_CONTENT');

  const created = await withTransaction(async (client) => {
    await assertSelectedUsersAreFriends(client, req.userId, visibleUserIds);
    const { rows } = await client.query(
      `INSERT INTO posts (author_id, content, media, visibility, status)
       VALUES ($1,$2,$3,$4,1) RETURNING *`,
      [req.userId, content, JSON.stringify(media), visibility]
    );
    if (visibleUserIds.length > 0) {
      await client.query(
        `INSERT INTO post_visible_users (post_id, user_id)
         SELECT $1, visible_user_id
         FROM unnest($2::bigint[]) AS visible_user_id`,
        [rows[0].id, visibleUserIds]
      );
    }
    return rows[0];
  });
  const { rows: withAuthor } = await query(
    `SELECT p.*, u.nickname, u.avatar, u.is_verified, FALSE AS liked,
            COALESCE(
              (
                SELECT json_agg(pvu.user_id::text ORDER BY pvu.user_id)
                FROM post_visible_users pvu
                WHERE pvu.post_id = p.id
              ),
              '[]'::json
            ) AS visible_user_ids
     FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = $1`, [created.id]
  );
  res.json({ ok: true, data: shapePost(withAuthor[0], req.userId) });
}));

router.patch('/:id/visibility', requireAuth, asyncHandler(async (req, res) => {
  const { visibility, visibleUserIds } = parseAudience(req.body);
  const updated = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT * FROM posts WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    const post = rows[0];
    if (!post || post.status !== 1) throw new ApiError(404, '动态不存在', 'NOT_FOUND');
    if (String(post.author_id) !== String(req.userId)) {
      throw new ApiError(403, '不能修改他人的动态', 'FORBIDDEN');
    }
    await assertSelectedUsersAreFriends(client, req.userId, visibleUserIds);
    await client.query('UPDATE posts SET visibility = $1 WHERE id = $2', [visibility, post.id]);
    await client.query('DELETE FROM post_visible_users WHERE post_id = $1', [post.id]);
    if (visibleUserIds.length > 0) {
      await client.query(
        `INSERT INTO post_visible_users (post_id, user_id)
         SELECT $1, visible_user_id
         FROM unnest($2::bigint[]) AS visible_user_id`,
        [post.id, visibleUserIds]
      );
    }
    return post.id;
  });
  const { rows } = await query(
    `SELECT p.*, u.nickname, u.avatar, u.is_verified,
            EXISTS(
              SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = $2
            ) AS liked,
            COALESCE(
              (
                SELECT json_agg(pvu.user_id::text ORDER BY pvu.user_id)
                FROM post_visible_users pvu
                WHERE pvu.post_id = p.id
              ),
              '[]'::json
            ) AS visible_user_ids
     FROM posts p
     JOIN users u ON u.id = p.author_id
     WHERE p.id = $1`,
    [updated, req.userId]
  );
  res.json({ ok: true, data: shapePost(rows[0], req.userId) });
}));

// 点赞 / 取消 (幂等): POST /posts/:id/like  body { like: true|false }
router.post('/:id/like', requireAuth, asyncHandler(async (req, res) => {
  const postId = req.params.id;
  const like = req.body.like !== false;
  await withTransaction(async (client) => {
    await assertCanViewPost(req.userId, postId, client);
    if (like) {
      const r = await client.query(
        'INSERT INTO post_likes (post_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [postId, req.userId]
      );
      if (r.rowCount > 0) await client.query('UPDATE posts SET like_count = like_count + 1 WHERE id = $1', [postId]);
    } else {
      const r = await client.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2', [postId, req.userId]);
      if (r.rowCount > 0) await client.query('UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1', [postId]);
    }
  });
  const { rows } = await query('SELECT like_count FROM posts WHERE id = $1', [postId]);
  res.json({ ok: true, data: { liked: like, likeCount: rows[0].like_count } });
}));

// 删除自己的动态 (软删除)
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT author_id, status FROM posts WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!rows[0] || rows[0].status !== 1) throw new ApiError(404, '动态不存在', 'NOT_FOUND');
    if (String(rows[0].author_id) !== String(req.userId)) {
      throw new ApiError(403, '不能删除他人的动态', 'FORBIDDEN');
    }
    await client.query('UPDATE posts SET status = 2 WHERE id = $1', [req.params.id]);
    await client.query('DELETE FROM post_visible_users WHERE post_id = $1', [req.params.id]);
  });
  res.json({ ok: true });
}));

module.exports = router;
