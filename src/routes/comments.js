'use strict';
const express = require('express');
const { query, withTransaction } = require('../db');
const { ApiError, asyncHandler } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const { isContentSafe } = require('../utils/validators');
const { assertCanViewPost } = require('../services/accessPolicy');
const { requirePositiveIntegerParam } = require('../middleware/validateRequest');

// mergeParams: 让本路由能读取父级 /posts/:postId 的参数
const router = express.Router({ mergeParams: true });
router.param('postId', requirePositiveIntegerParam('postId'));

// 评论列表: GET /posts/:postId/comments
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  await assertCanViewPost(req.userId, req.params.postId);
  const { rows } = await query(
    `SELECT c.*, u.nickname, u.avatar FROM comments c
     JOIN users u ON u.id = c.author_id
     WHERE c.post_id = $1 AND c.status = 1
       AND NOT EXISTS (
         SELECT 1 FROM user_blocks blocked
         WHERE (blocked.user_id = $2 AND blocked.blocked_id = c.author_id)
            OR (blocked.user_id = c.author_id AND blocked.blocked_id = $2)
       )
     ORDER BY c.created_at ASC`, [req.params.postId, req.userId]
  );
  const items = rows.map((r) => ({
    id: String(r.id),
    author: { id: String(r.author_id), nickname: r.nickname, avatar: r.avatar },
    content: r.content,
    createdAt: r.created_at,
  }));
  res.json({ ok: true, data: { items } });
}));

// 发表评论: POST /posts/:postId/comments { content }
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) throw new ApiError(400, '评论不能为空', 'EMPTY');
  if (content.length > 300) throw new ApiError(400, '评论不能超过 300 字', 'TOO_LONG');
  if (!isContentSafe(content)) throw new ApiError(400, '内容可能包含联系方式或不适宜信息', 'BLOCKED_CONTENT');

  const postId = req.params.postId;
  const created = await withTransaction(async (client) => {
    await assertCanViewPost(req.userId, postId, client);
    const ins = await client.query(
      `INSERT INTO comments (post_id, author_id, content)
       VALUES ($1,$2,$3)
       RETURNING id, content, created_at`,
      [postId, req.userId, content]
    );
    await client.query('UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1', [postId]);
    return ins.rows[0];
  });
  const { rows: authors } = await query(
    'SELECT id, nickname, avatar, is_verified FROM users WHERE id = $1',
    [req.userId]
  );
  const author = authors[0];
  res.json({
    ok: true,
    data: {
      id: String(created.id),
      author: {
        id: String(author.id),
        nickname: author.nickname,
        avatar: author.avatar,
        isVerified: author.is_verified,
      },
      content: created.content,
      createdAt: created.created_at,
    },
  });
}));

module.exports = router;
