ALTER TABLE users
    ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_identity_required') THEN
        ALTER TABLE users ADD CONSTRAINT users_identity_required CHECK (
            phone IS NOT NULL OR username IS NOT NULL OR wechat_unionid IS NOT NULL
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'babies_gender_valid') THEN
        ALTER TABLE babies ADD CONSTRAINT babies_gender_valid CHECK (gender IN (0, 1, 2));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_counts_nonnegative') THEN
        ALTER TABLE posts ADD CONSTRAINT posts_counts_nonnegative CHECK (like_count >= 0 AND comment_count >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_status_valid') THEN
        ALTER TABLE posts ADD CONSTRAINT posts_status_valid CHECK (status IN (0, 1, 2, 3));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_visibility_valid') THEN
        ALTER TABLE posts ADD CONSTRAINT posts_visibility_valid CHECK (visibility IN (0, 1));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_status_valid') THEN
        ALTER TABLE comments ADD CONSTRAINT comments_status_valid CHECK (status IN (0, 1, 2));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'walk_plans_duration_valid') THEN
        ALTER TABLE walk_plans ADD CONSTRAINT walk_plans_duration_valid CHECK (duration_minutes BETWEEN 30 AND 360);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'walk_plans_participant_limit_valid') THEN
        ALTER TABLE walk_plans ADD CONSTRAINT walk_plans_participant_limit_valid CHECK (participant_limit BETWEEN 2 AND 20);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'walk_plans_visibility_valid') THEN
        ALTER TABLE walk_plans ADD CONSTRAINT walk_plans_visibility_valid CHECK (visibility IN (0, 1));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'walk_plans_status_valid') THEN
        ALTER TABLE walk_plans ADD CONSTRAINT walk_plans_status_valid CHECK (status IN (1, 2));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_members_status_valid') THEN
        ALTER TABLE plan_members ADD CONSTRAINT plan_members_status_valid CHECK (status IN (0, 1, 2));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friendships_ordered_users') THEN
        ALTER TABLE friendships ADD CONSTRAINT friendships_ordered_users CHECK (user_a_id < user_b_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friend_requests_not_self') THEN
        ALTER TABLE friend_requests ADD CONSTRAINT friend_requests_not_self CHECK (sender_id <> receiver_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'friend_requests_status_valid') THEN
        ALTER TABLE friend_requests ADD CONSTRAINT friend_requests_status_valid CHECK (status IN (0, 1, 2));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_target_type_valid') THEN
        ALTER TABLE reports ADD CONSTRAINT reports_target_type_valid CHECK (target_type IN (0, 1, 2, 3));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_reason_valid') THEN
        ALTER TABLE reports ADD CONSTRAINT reports_reason_valid CHECK (reason IN (0, 1, 2, 3));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_blocks_not_self') THEN
        ALTER TABLE user_blocks ADD CONSTRAINT user_blocks_not_self CHECK (user_id <> blocked_id);
    END IF;
END $$;

WITH duplicate_pending AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY sender_id, receiver_id ORDER BY created_at DESC, id DESC) AS position
    FROM friend_requests
    WHERE status = 0
)
UPDATE friend_requests
SET status = 2
WHERE id IN (SELECT id FROM duplicate_pending WHERE position > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_req_unique_pending
    ON friend_requests(sender_id, receiver_id) WHERE status = 0;
