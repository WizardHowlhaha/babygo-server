# BabyGo 后端服务

BabyGo 亲子社交 App 的后端基线。技术栈 **Node.js + Express + PostgreSQL 16 / PostGIS 3.4**。核心业务链路已可用，但短信、微信 OAuth 和对象存储 provider 仍未实现，不能把配置完整误认为能力已上线。

覆盖 App 全部核心场景:
- 账号密码注册/登录(**始终可用**,手动方式)
- 手机验证码注册/登录/找回(**仅开发桩**，`ALLOW_INSECURE_DEV_AUTH=true` 时返回固定验证码 `123456`)
- 微信授权登录(**预留桩**,未配置时返回 501 提示)
- 发布动态(文字/图片/视频)+ 动态流(游标分页)+ 点赞 + 评论
- 遛娃活动发布/加入/审核/邀请 + **基于地理位置的"附近活动发现"**(PostGIS)
- 好友请求/通过/列表、拉黑、举报
- 媒体上传凭证(**未实现 provider**，不会返回伪签名 URL)
- 内容安全校验(拦截联系方式与不适宜词汇,保护儿童安全)

---

## 一、环境要求

- Node.js ≥ 18(已在 v24 验证)
- Docker(用于一键起 PostgreSQL/PostGIS);OrbStack 或 Docker Desktop 均可

## 二、快速开始

```bash
# 1. 安装依赖(已完成可跳过)
npm install

# 2. 准备环境变量
cp .env.example .env
# 按需修改 .env(本地开发可直接用默认值)

# 3. 启动数据库(首次启动会自动执行 db/schema.sql 建表 + 装 PostGIS)
npm run db:up
#   —— 需要 Docker 守护进程在运行。OrbStack 用户请先打开 OrbStack App。

# 4. 启动服务
npm start
# 启动前会自动执行 db/migrations；看到 server.started 日志即成功

# 5. (可选)另开一个终端跑端到端冒烟测试
npm run smoke
```

关闭数据库:`npm run db:down`(数据保留在 Docker volume;彻底清库用 `docker compose down -v`)。

## 三、环境变量说明(.env)

| 变量 | 说明 | 未配置时行为 |
|---|---|---|
| `PORT` | 服务端口,默认 3000 | — |
| `DATABASE_URL` | Postgres 连接串 | 默认连本地 docker 实例 |
| `JWT_SECRET` | JWT 签名密钥,**上线务必改成强随机值** | 用开发默认值 |
| `JWT_EXPIRES_IN` | Token 有效期,默认 30d | — |
| `JWT_ISSUER/AUDIENCE` | JWT 签发者与受众校验 | `babygo-server` / `babygo-app` |
| `ALLOW_INSECURE_DEV_AUTH` | 是否启用固定验证码开发桩 | 开发默认开启，生产必须关闭 |
| `TRUST_PROXY` | 服务是否位于可信反向代理之后 | `false` |
| `CORS_ORIGINS` | 允许的浏览器 Origin，逗号分隔 | 空（禁用跨域浏览器请求） |
| `LOG_LEVEL` | JSON 结构化日志级别:`debug/info/warn/error/silent` | `info` |
| `LOG_FILE` | 可选日志文件路径;本地默认写入 `logs/babygo-server.log` | 生产默认仅 stdout/stderr |
| `SMS_*` | 短信服务商密钥 | 留空 = 桩模式,验证码固定 `123456` |
| `WECHAT_APP_ID/SECRET` | 微信开放平台应用 | 留空 = `/api/auth/wechat` 返回 501 |
| `OSS_*` | 对象存储(OSS/COS/S3) | 留空 = 上传凭证返回占位符 |

> `GET /health` 只会把真正可用的能力标记为 `true`。当前 `sms/wechat/oss` 均为 `false`；开发验证码桩单独由 `smsDevelopmentStub` 标识。

## 四、接口一览(全部以 `/api` 前缀)

### 认证 `/api/auth`
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/register` | 手机验证码+密码注册 |
| POST | `/login` | 手机号+密码登录(可用) |
| POST | `/sms/send` | 发送验证码(桩:返回 `devCode`) |
| POST | `/sms/login` | 验证码登录/注册即登录 |
| POST | `/reset-password` | 验证码重置密码并撤销旧会话 |
| POST | `/wechat` | 微信登录(桩:501) |
| GET | `/me` | 当前用户(需鉴权) |
| PATCH | `/privacy` | 更新宝宝年龄、附近发现和好友申请隐私偏好 |
| POST | `/change-password` | 修改密码(需鉴权) |

### 动态 `/api/posts`
`GET /feed`(成长圈游标分页) · `GET /mine`(当前账号动态游标分页) · `POST /`(发布，支持公开/好友/仅自己/指定好友) · `PATCH /:id/visibility`(修改可见范围) · `POST /:id/like`(点赞,幂等) · `DELETE /:id`(软删除) · `GET|POST /:postId/comments`(评论)

### 活动 `/api/plans`
`POST /`(发布,含经纬度) · `GET /nearby?lat=&lng=&radius=`(附近发现) · `GET /mine` · `GET /:id`(详情+成员) · `POST /:id/apply`(申请) · `POST /:id/review`(主审核) · `POST /:id/respond`(回应邀请) · `POST /:id/invite`(邀请) · `DELETE /:id`(取消)

### 好友 `/api/friends`
`GET /` · `GET /requests` · `POST /requests` · `POST /requests/:id/respond` · `POST /block` · `DELETE /block/:userId` · `POST /report`

### 媒体 `/api/media`
`POST /upload-token`(桩:返回占位凭证)

### 其它
`GET /health`(健康检查 + 能力开关)

统一响应格式:成功 `{ ok: true, data: ... }`;失败 `{ ok: false, error: { code, message }, requestId }`。
鉴权:除注册/登录/短信/微信/health 外,均需请求头 `Authorization: Bearer <token>`。

## 五、运行日志与排查

- 服务端每个请求输出一行 JSON,包含 `requestId/method/path/status/durationMs`;响应头 `X-Request-ID` 与失败响应的 `requestId` 可用于串联客户端和服务端日志。
- 本地开发默认同时写终端和 `logs/babygo-server.log`;实时查看:`tail -f logs/babygo-server.log`。生产环境建议 `LOG_FILE=` 仅写 stdout/stderr,交给容器平台或 systemd 做轮转、留存和检索。
- 日志不记录请求体、密码、JWT、短信验证码、手机号、用户名、精确位置或宝宝身份信息。排查认证问题时按 `requestId` 搜索,不要临时打印敏感字段。
- 建议生产保留应用日志 14–30 天、访问审计日志 90–180 天,并按错误率、P95 延迟、401/429 激增和数据库不可用配置告警;具体周期需按隐私政策和适用法规确认。

## 六、上线前 checklist

1. **改 `JWT_SECRET`** 为至少 32 字符强随机值，关闭 `ALLOW_INSECURE_DEV_AUTH`；服务会在生产配置不安全时拒绝启动。
2. 申请并填入 `SMS_*`(短信)、`WECHAT_*`(微信开放平台)、`OSS_*`(对象存储)。
3. 实现对应 provider 适配器和测试；当前仅填环境变量仍会明确返回 501，不会伪成功。
4. 数据库放到托管实例(RDS 等),配置定时备份;应用前置 Nginx/负载均衡 + HTTPS。
5. 配置 `TRUST_PROXY/CORS_ORIGINS`、集中限流存储、指标告警与脱敏审计。

## 七、质量门禁

```bash
npm run check      # 全部 JS 语法检查
npm test           # 配置、JWT、验证码用途隔离、位置脱敏等单元测试
npm audit --omit=dev --audit-level=high
npm run db:migrate # 手动执行幂等数据库迁移（npm start 也会自动执行）
```

## 八、目录结构

```
babygo-server/
├─ db/schema.sql          # 建表脚本(容器首启自动执行)
├─ docker-compose.yml     # PostGIS 容器
├─ src/
│  ├─ index.js            # Express 入口(路由挂载/限流/错误处理/health)
│  ├─ config.js           # 读取 .env
│  ├─ db.js               # pg 连接池 + 事务封装
│  ├─ middleware/         # 鉴权 / 统一错误处理
│  ├─ utils/              # 密码 / JWT / 校验
│  ├─ services/           # 短信·微信·媒体(均为预留桩)
│  ├─ routes/             # auth / posts / comments / plans / friends / media
│  └─ scripts/smokeTest.js
└─ .env.example
```

## 维护规则

修改路由、领域状态、鉴权策略、环境变量、迁移或第三方能力时，必须同步更新本 README、`.env.example`、`db/migrations/` 与对应测试；禁止把“已配置”“开发桩”或“接口预留”写成“生产可用”。
