-- BabyGo 数据库结构 (PostgreSQL 16 + PostGIS 3.4)
-- 该文件在 docker compose 首次启动时自动执行

CREATE EXTENSION IF NOT EXISTS postgis;

-- ===================== 用户 =====================
CREATE TABLE IF NOT EXISTS users (
    id              BIGSERIAL PRIMARY KEY,
    phone           VARCHAR(20)  UNIQUE,               -- 手机号(验证码登录用, 预留)
    username        VARCHAR(20)  UNIQUE,               -- 用户名(用户名密码注册用)
    wechat_unionid  VARCHAR(64)  UNIQUE,               -- 微信 unionid(微信登录用, 预留)
    password_hash   VARCHAR(128),                      -- bcrypt 哈希(纯微信用户可为空)
    nickname        VARCHAR(32)  NOT NULL,
    avatar          VARCHAR(255) DEFAULT '',
    bio             VARCHAR(200) DEFAULT '',
    city            VARCHAR(50)  DEFAULT '',
    is_verified     BOOLEAN      DEFAULT FALSE,
    is_wechat_bound BOOLEAN      DEFAULT FALSE,
    show_baby_age   BOOLEAN      NOT NULL DEFAULT TRUE,
    allow_nearby_discovery BOOLEAN NOT NULL DEFAULT TRUE,
    allow_friend_requests BOOLEAN NOT NULL DEFAULT TRUE,
    token_version   INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  DEFAULT NOW(),
    CONSTRAINT users_identity_required CHECK (
        phone IS NOT NULL OR username IS NOT NULL OR wechat_unionid IS NOT NULL
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username));

-- ===================== 宝宝档案 =====================
CREATE TABLE IF NOT EXISTS babies (
    id         BIGSERIAL PRIMARY KEY,
    owner_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nickname   VARCHAR(32) NOT NULL,
    birthday   DATE NOT NULL,
    gender     SMALLINT NOT NULL DEFAULT 2,            -- 0男 1女 2不公开
    interests  JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT babies_gender_valid CHECK (gender IN (0, 1, 2))
);
CREATE INDEX IF NOT EXISTS idx_babies_owner ON babies(owner_id);

-- ===================== 动态 =====================
CREATE TABLE IF NOT EXISTS posts (
    id            BIGSERIAL PRIMARY KEY,
    author_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content       TEXT DEFAULT '',
    media         JSONB DEFAULT '[]',                  -- [{type,url,width,height,cover,duration}]
    like_count    INT DEFAULT 0,
    comment_count INT DEFAULT 0,
    status        SMALLINT DEFAULT 1,                  -- 0审核中 1正常 2删除 3下架
    visibility    SMALLINT DEFAULT 0,                  -- 0公开 1仅好友 2仅自己 3指定好友
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT posts_counts_nonnegative CHECK (like_count >= 0 AND comment_count >= 0),
    CONSTRAINT posts_status_valid CHECK (status IN (0, 1, 2, 3)),
    CONSTRAINT posts_visibility_valid CHECK (visibility IN (0, 1, 2, 3))
);
CREATE INDEX IF NOT EXISTS idx_posts_author_time ON posts(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_time ON posts(created_at DESC);

CREATE TABLE IF NOT EXISTS post_visible_users (
    post_id    BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_post_visible_users_user ON post_visible_users(user_id, post_id);

-- ===================== 点赞 =====================
CREATE TABLE IF NOT EXISTS post_likes (
    post_id    BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);

-- ===================== 评论 =====================
CREATE TABLE IF NOT EXISTS comments (
    id         BIGSERIAL PRIMARY KEY,
    post_id    BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    VARCHAR(300) NOT NULL,
    status     SMALLINT DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT comments_status_valid CHECK (status IN (0, 1, 2))
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);

-- ===================== 遛娃活动 =====================
CREATE TABLE IF NOT EXISTS walk_plans (
    id                    BIGSERIAL PRIMARY KEY,
    owner_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title                 VARCHAR(50) NOT NULL,
    summary               VARCHAR(500) DEFAULT '',
    starts_at             TIMESTAMPTZ NOT NULL,
    duration_minutes      INT NOT NULL DEFAULT 60,
    participant_limit     INT NOT NULL DEFAULT 4,
    approximate_place     VARCHAR(100) DEFAULT '',     -- 【公开】模糊地点
    private_meeting_point VARCHAR(200) DEFAULT '',     -- 【私密】仅成员可见
    geo                   GEOGRAPHY(POINT, 4326),      -- 经纬度点
    visibility            SMALLINT DEFAULT 0,          -- 0附近可见 1仅好友
    status                SMALLINT DEFAULT 1,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT walk_plans_duration_valid CHECK (duration_minutes BETWEEN 30 AND 360),
    CONSTRAINT walk_plans_participant_limit_valid CHECK (participant_limit BETWEEN 2 AND 20),
    CONSTRAINT walk_plans_visibility_valid CHECK (visibility IN (0, 1)),
    CONSTRAINT walk_plans_status_valid CHECK (status IN (1, 2))
);
CREATE INDEX IF NOT EXISTS idx_walk_plans_geo ON walk_plans USING GIST(geo);
CREATE INDEX IF NOT EXISTS idx_walk_plans_starts ON walk_plans(starts_at);

-- ===================== 活动成员 =====================
CREATE TABLE IF NOT EXISTS plan_members (
    plan_id    BIGINT NOT NULL REFERENCES walk_plans(id) ON DELETE CASCADE,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     SMALLINT NOT NULL,                      -- 0被邀请 1申请中 2已通过
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (plan_id, user_id),
    CONSTRAINT plan_members_status_valid CHECK (status IN (0, 1, 2))
);

-- ===================== 好友关系 / 请求 =====================
CREATE TABLE IF NOT EXISTS friendships (
    id         BIGSERIAL PRIMARY KEY,
    user_a_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- 约定: 小 id 在前
    user_b_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_a_id, user_b_id),
    CONSTRAINT friendships_ordered_users CHECK (user_a_id < user_b_id)
);

CREATE TABLE IF NOT EXISTS friend_requests (
    id          BIGSERIAL PRIMARY KEY,
    sender_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status      SMALLINT DEFAULT 0,                     -- 0待处理 1同意 2拒绝
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT friend_requests_not_self CHECK (sender_id <> receiver_id),
    CONSTRAINT friend_requests_status_valid CHECK (status IN (0, 1, 2))
);
CREATE INDEX IF NOT EXISTS idx_friend_req_receiver ON friend_requests(receiver_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_req_unique_pending
    ON friend_requests(sender_id, receiver_id) WHERE status = 0;

-- ===================== 举报 / 拉黑 =====================
CREATE TABLE IF NOT EXISTS reports (
    id          BIGSERIAL PRIMARY KEY,
    reporter_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type SMALLINT NOT NULL,                      -- 0动态 1评论 2用户 3活动
    target_id   BIGINT NOT NULL,
    reason      SMALLINT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT reports_target_type_valid CHECK (target_type IN (0, 1, 2, 3)),
    CONSTRAINT reports_reason_valid CHECK (reason IN (0, 1, 2, 3))
);

CREATE TABLE IF NOT EXISTS user_blocks (
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, blocked_id),
    CONSTRAINT user_blocks_not_self CHECK (user_id <> blocked_id)
);
