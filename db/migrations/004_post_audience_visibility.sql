ALTER TABLE posts
    DROP CONSTRAINT IF EXISTS posts_visibility_valid;

ALTER TABLE posts
    ADD CONSTRAINT posts_visibility_valid CHECK (visibility IN (0, 1, 2, 3));

CREATE TABLE IF NOT EXISTS post_visible_users (
    post_id    BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_visible_users_user
    ON post_visible_users(user_id, post_id);
