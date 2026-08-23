# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# BabyGo Server

Node.js + Express 后端服务，为 BabyGo iOS 应用提供 API。

> **关联项目**: 本项目与 `babygo/` iOS 客户端共同组成 BabyGo 应用。

## 常用命令

```bash
npm install           # 安装依赖
npm run db:up         # 启动 PostgreSQL (Docker)
npm run db:down       # 停止数据库
npm run db:migrate    # 运行迁移
npm start             # 启动服务 (默认 :3000)
npm run smoke         # 冒烟测试
```

## 技术栈

- **Runtime**: Node.js (CommonJS)
- **Framework**: Express 4.19
- **Database**: PostgreSQL 16 + PostGIS 3.4
- **Auth**: JWT (jsonwebtoken)
- **Password**: bcryptjs

## 架构

### 分层结构

```
routes/      → 路由定义，调用 services
services/    → 业务逻辑，数据操作
middleware/  → 认证、日志、错误处理
utils/       → JWT、密码、日志等工具
```

### 数据库

- `db.js` 提供连接池和 `withTransaction()` 事务封装
- `db/migrations/` 增量 SQL 迁移
- PostGIS geography 类型支持地理位置查询 (附近遛娃活动)

### API 规范

- 统一响应: `{ ok: true, data: ... }` 或 `{ ok: false, error: { code, message }, requestId: "..." }`
- 认证: `Authorization: Bearer <token>` (auth 接口除外)
- 错误码: 4 字符 (如 `AUTH_001`)

### 路由

| 前缀 | 功能 |
|------|------|
| `/api/auth` | 注册、登录、短信、重置密码、微信、隐私 |
| `/api/posts` | 动态 CRUD、点赞、软删除 |
| `/api/posts/:postId/comments` | 评论 |
| `/api/plans` | 遛娃活动 (附近、申请、审核、邀请) |
| `/api/friends` | 好友列表、请求、屏蔽、举报 |
| `/api/babies` | 宝宝档案 CRUD |
| `/health` | 健康检查，含功能开关 |

### 功能 Stubs

未配置环境变量时返回 501:
- SMS: 设置 `ALLOW_INSECURE_DEV_AUTH=true` 使用 stub `123456`
- 微信登录: 配置 `WECHAT_*`
- 文件上传: 配置 `OSS_*`

## 内容安全

- `src/utils/validators.js` 的 `isContentSafe()` 为临时缓解方案
- 生产环境应使用云内容审核服务（阿里云/腾讯云）
- 当前实现检测：手机号（支持分隔符）、违禁词列表

## 环境变量

| 变量 | 说明 |
|------|------|
| `PORT` | 服务端口 (默认 3000) |
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `JWT_SECRET` | JWT 签名密钥 |
| `JWT_ISSUER`, `JWT_AUDIENCE` | JWT 校验 |
| `ALLOW_INSECURE_DEV_AUTH` | 开发模式 SMS stub |
| `SMS_*`, `WECHAT_*`, `OSS_*` | 第三方服务配置 |

## 开发约定

- 请求级别 `requestId` 用于追踪
- JSON 结构化日志输出到 `logs/` 和 stdout
- 密码修改使旧会话失效
- 软删除 (soft delete)
- 限流: 120 请求/分钟
