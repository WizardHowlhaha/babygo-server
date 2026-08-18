# iOS 端接入后端说明

从本次改造起,iOS 客户端**默认直连真实后端**,已彻底移除本地演示数据(`forceLocalDemo`)与演示开关。`AppStore` 启动即用 `RemoteAuthService` 登录、用 `BabyGoAPI` 拉取全部数据,并通过 `BackendMapper` 把后端 DTO 映射为 App 内领域模型。

本文件夹内的 Swift 文件是客户端网络层的参考快照,实际编译的源码位于 `babygo/babygo/Networking/`。复制参考代码后仍应以客户端目录为准;日志统一由客户端 `Core/AppLogger.swift` 提供。

## 一、文件清单(babygo/babygo/Networking/)

- `BackendConfig.swift` — 后端地址(DEBUG 走 `http://127.0.0.1:3000`,RELEASE 走生产域名)+ `apiPrefix`。
- `APIModels.swift` — 后端 JSON 对应的 Codable 模型。
- `APIClient.swift` — 底层 HTTP:拼请求、带 JWT、解析 `{ok,data}` 外壳、错误映射;`APITokenStore` 用 Keychain 存 JWT。
- `BabyGoAPI.swift` — 每个后端接口对应一个 async 方法。
- `RemoteAuthService.swift` — 实现 `AuthServicing` 协议,登录/注册界面零改动直连后端。
- `BackendMapper.swift` — 后端 DTO → App 领域模型(`AppSnapshot`)映射,后端整型 id 经 `UUID(stableFrom:)` 生成稳定 UUID。

## 二、允许访问本机 HTTP(仅开发期)

iOS 默认禁止明文 HTTP。开发连本机后端时,在 target 的 **Info** 里加 App Transport Security 例外:`App Transport Security Settings` → `Allow Arbitrary Loads` = `YES`。上线用 HTTPS 域名后请删掉该例外。

## 三、跑起来

1. 先在电脑上启动后端(见 babygo-server 的 README:`npm run db:up` + `npm start`)。
2. 模拟器保持 `http://127.0.0.1:3000`;真机把 `BackendConfig.debugBaseURL` 改成电脑局域网 IP,如 `http://192.168.1.10:3000`。
3. 直接运行 App:注册/登录会真实建号并保存 JWT,成长圈、活动、好友、宝宝档案等页面全部读写真实后端。
4. 排查请求时用客户端日志里的 `request_id` 搜索服务端 `logs/babygo-server.log`;两端通过 `X-Request-ID` 关联,且均不得记录账号、密码、Token、精确位置等敏感数据。

## 四、各能力当前状态

| 能力 | 状态 | 说明 |
|---|---|---|
| 账号密码 注册/登录 | 已打通 | `RemoteAuthService` 直连后端,真实建号 |
| 用户名 注册/登录/查重 | 已打通 | `BabyGoAPI.registerWithUsername/loginWithUsername/checkUsername` |
| 修改密码 | 已打通 | 需已登录(带 JWT) |
| 宝宝档案 | 已打通 | `BabyGoAPI.myBabies/babies/createBaby` |
| 动态 / 评论 / 点赞 | 已打通 | `BabyGoAPI.feed/publishPost/toggleLike/addComment` |
| 活动 / 附近发现 | 已打通 | `BabyGoAPI.nearbyPlans/createPlan/applyToPlan…` |
| 好友 / 拉黑 / 举报 | 已打通 | `BabyGoAPI.friends/sendFriendRequest…` |
| 手机验证码 | 预留桩 | 后端未接短信时验证码固定 `123456`;`sendSMSCode/smsLogin` 已就绪 |
| 微信登录/绑定 | 预留桩 | 后端未配置时返回 501;接入微信开放平台后填 `WECHAT_*` |
| 找回密码 | 依赖短信 | 接入短信服务后可用 |
| 视频上传 | 预留桩 | 后端接入对象存储前,发视频会提示需先配置对象存储 |

## 五、数据映射要点

- 后端 id 为整型字符串,客户端统一用 `UUID(stableFrom: "babygo-<kind>-<id>")` 生成稳定 UUID;写操作时 `AppStore` 维护反向映射(UUID → 后端 id)。
- 点赞:后端只给 `likeCount` 与是否已赞,`BackendMapper` 用合成占位补齐 `likedBy` 集合,保证计数与当前用户点赞态都正确。
- 活动:列表接口用合成成员补齐 `acceptedCount`;我发起的活动额外拉取详情以获得真实待审成员。
