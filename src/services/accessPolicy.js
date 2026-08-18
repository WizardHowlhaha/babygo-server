'use strict';
const { query } = require('../db');
const { ApiError } = require('../middleware/errorHandler');

function assertPositiveIntegerId(value) {
  if (!/^[1-9]\d*$/.test(String(value))) {
    throw new ApiError(400, '资源 ID 格式不正确', 'INVALID_ID');
  }
}

function executorQuery(executor, text, params) {
  return executor && typeof executor.query === 'function'
    ? executor.query(text, params)
    : query(text, params);
}

async function getUserRelationship(viewerId, targetId, executor) {
  assertPositiveIntegerId(viewerId);
  assertPositiveIntegerId(targetId);
  const { rows } = await executorQuery(
    executor,
    `SELECT
       EXISTS(SELECT 1 FROM users WHERE id = $2) AS target_exists,
       EXISTS(
         SELECT 1 FROM friendships
         WHERE user_a_id = LEAST($1::bigint, $2::bigint)
           AND user_b_id = GREATEST($1::bigint, $2::bigint)
       ) AS are_friends,
       EXISTS(
         SELECT 1 FROM user_blocks
         WHERE (user_id = $1 AND blocked_id = $2)
            OR (user_id = $2 AND blocked_id = $1)
       ) AS is_blocked`,
    [viewerId, targetId]
  );
  return rows[0];
}

async function assertCanViewUser(viewerId, targetId, executor) {
  if (String(viewerId) === String(targetId)) return;
  const relationship = await getUserRelationship(viewerId, targetId, executor);
  if (!relationship?.target_exists) {
    throw new ApiError(404, '用户不存在', 'USER_NOT_FOUND');
  }
  if (relationship.is_blocked || !relationship.are_friends) {
    throw new ApiError(403, '无权查看该用户资料', 'FORBIDDEN');
  }
}

async function assertCanViewPost(viewerId, postId, executor) {
  assertPositiveIntegerId(viewerId);
  assertPositiveIntegerId(postId);
  const { rows } = await executorQuery(
    executor,
    `SELECT p.id, p.author_id, p.visibility, p.status,
       EXISTS(
         SELECT 1 FROM friendships
         WHERE user_a_id = LEAST($1::bigint, p.author_id)
           AND user_b_id = GREATEST($1::bigint, p.author_id)
       ) AS are_friends,
       EXISTS(
         SELECT 1 FROM user_blocks
         WHERE (user_id = $1 AND blocked_id = p.author_id)
            OR (user_id = p.author_id AND blocked_id = $1)
       ) AS is_blocked,
       EXISTS(
         SELECT 1 FROM post_visible_users pvu
         WHERE pvu.post_id = p.id AND pvu.user_id = $1
       ) AS is_selected_viewer
     FROM posts p
     WHERE p.id = $2`,
    [viewerId, postId]
  );
  const post = rows[0];
  if (!post || post.status !== 1) {
    throw new ApiError(404, '动态不存在', 'NOT_FOUND');
  }
  const isOwner = String(post.author_id) === String(viewerId);
  const canView = isOwner ||
    post.visibility === 0 ||
    (post.visibility === 1 && post.are_friends) ||
    (post.visibility === 3 && post.is_selected_viewer);
  if (post.is_blocked || !canView) {
    throw new ApiError(403, '无权查看该动态', 'FORBIDDEN');
  }
  return post;
}

async function assertCanViewPlan(viewerId, planId, executor) {
  assertPositiveIntegerId(viewerId);
  assertPositiveIntegerId(planId);
  const { rows } = await executorQuery(
    executor,
    `SELECT wp.*,
       EXISTS(
         SELECT 1 FROM friendships
         WHERE user_a_id = LEAST($1::bigint, wp.owner_id)
           AND user_b_id = GREATEST($1::bigint, wp.owner_id)
       ) AS are_friends,
       EXISTS(
         SELECT 1 FROM user_blocks
         WHERE (user_id = $1 AND blocked_id = wp.owner_id)
            OR (user_id = wp.owner_id AND blocked_id = $1)
       ) AS is_blocked,
       (SELECT pm.status FROM plan_members pm WHERE pm.plan_id = wp.id AND pm.user_id = $1) AS member_status
     FROM walk_plans wp
     WHERE wp.id = $2`,
    [viewerId, planId]
  );
  const plan = rows[0];
  if (!plan || plan.status !== 1) {
    throw new ApiError(404, '活动不存在', 'NOT_FOUND');
  }
  const isOwner = String(plan.owner_id) === String(viewerId);
  const hasMembership = plan.member_status != null;
  if (plan.is_blocked || (plan.visibility === 1 && !isOwner && !hasMembership && !plan.are_friends)) {
    throw new ApiError(403, '无权查看该活动', 'FORBIDDEN');
  }
  return plan;
}

module.exports = {
  assertCanViewPlan,
  assertCanViewPost,
  assertCanViewUser,
  getUserRelationship,
};
