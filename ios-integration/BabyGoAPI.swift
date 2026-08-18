import Foundation

// ============================================================
// BabyGoAPI: 面向业务的高层封装, 每个方法对应一个后端接口。
// 视图 / ViewModel 只需调用这些 async 方法, 不用关心 URL 细节。
// 用法: try await BabyGoAPI.shared.login(phone:password:)
// ============================================================
final class BabyGoAPI {
    static let shared = BabyGoAPI()
    private let client = APIClient.shared
    private init() {}

    // ---------- 健康检查 / 能力探测 ----------
    func health() async throws -> APIHealth {
        // /health 不在 /api 前缀下, 单独处理
        var req = URLRequest(url: BackendConfig.baseURL.appendingPathComponent("/health"))
        req.httpMethod = "GET"
        let (data, _) = try await URLSession.shared.data(for: req)
        return try JSONDecoder().decode(APIHealth.self, from: data)
    }

    // ================= 认证 =================

    /// 账号密码注册(始终可用)。成功后自动保存 JWT。
    @discardableResult
    func register(phone: String, password: String, nickname: String?) async throws -> APIUser {
        var body: [String: Any] = ["phone": phone, "password": password]
        if let nickname, !nickname.isEmpty { body["nickname"] = nickname }
        let payload = try await client.request("/auth/register", method: "POST", body: body,
                                               authorized: false, as: APISessionPayload.self)
        try APITokenStore.shared.save(payload.token)
        return payload.user
    }

    /// 账号密码登录。成功后自动保存 JWT。
    @discardableResult
    func login(phone: String, password: String) async throws -> APIUser {
        let payload = try await client.request("/auth/login", method: "POST",
                                               body: ["phone": phone, "password": password],
                                               authorized: false, as: APISessionPayload.self)
        try APITokenStore.shared.save(payload.token)
        return payload.user
    }

    /// 发送手机验证码(预留)。桩模式下 devCode 返回 "123456"。
    func sendSMSCode(phone: String, purpose: String = "login") async throws -> APISendCodeResult {
        try await client.request("/auth/sms/send", method: "POST",
                                 body: ["phone": phone, "purpose": purpose],
                                 authorized: false, as: APISendCodeResult.self)
    }

    /// 验证码登录 / 注册即登录(预留)。成功后自动保存 JWT。
    @discardableResult
    func smsLogin(phone: String, code: String) async throws -> APIUser {
        let payload = try await client.request("/auth/sms/login", method: "POST",
                                               body: ["phone": phone, "code": code],
                                               authorized: false, as: APISessionPayload.self)
        try APITokenStore.shared.save(payload.token)
        return payload.user
    }

    /// 微信登录(预留)。后端未配置时会抛出 APIError.notConfigured。
    @discardableResult
    func wechatLogin(code: String) async throws -> APIUser {
        let payload = try await client.request("/auth/wechat", method: "POST",
                                               body: ["code": code],
                                               authorized: false, as: APISessionPayload.self)
        try APITokenStore.shared.save(payload.token)
        return payload.user
    }

    /// 用户名查重(POST /auth/check-username)。available=false 时附带可用推荐。
    func checkUsername(_ username: String) async throws -> APIUsernameCheck {
        try await client.request("/auth/check-username", method: "POST",
                                 body: ["username": username],
                                 authorized: false, as: APIUsernameCheck.self)
    }

    /// 用户名 + 密码 注册(POST /auth/register-username)。成功后自动保存 JWT。
    @discardableResult
    func registerWithUsername(username: String, password: String) async throws -> APIUser {
        let payload = try await client.request("/auth/register-username", method: "POST",
                                               body: ["username": username, "password": password],
                                               authorized: false, as: APISessionPayload.self)
        try APITokenStore.shared.save(payload.token)
        return payload.user
    }

    /// 用户名 + 密码 登录(POST /auth/login-username)。成功后自动保存 JWT。
    @discardableResult
    func loginWithUsername(username: String, password: String) async throws -> APIUser {
        let payload = try await client.request("/auth/login-username", method: "POST",
                                               body: ["username": username, "password": password],
                                               authorized: false, as: APISessionPayload.self)
        try APITokenStore.shared.save(payload.token)
        return payload.user
    }

    func me() async throws -> APIUser {
        try await client.request("/auth/me", method: "GET", as: APIUser.self)
    }

    func changePassword(old: String, new: String) async throws {
        try await client.requestVoid("/auth/change-password", method: "POST",
                                     body: ["oldPassword": old, "newPassword": new])
    }

    /// 退出登录: 清除本地 JWT。
    func logout() { APITokenStore.shared.clear() }

    // ================= 动态 =================

    func feed(cursor: String? = nil, limit: Int = 20) async throws -> APIFeedPage {
        var q = ["limit": String(limit)]
        if let cursor { q["cursor"] = cursor }
        return try await client.request("/posts/feed", method: "GET", query: q, as: APIFeedPage.self)
    }

    @discardableResult
    func publishPost(content: String, media: [APIMediaItem] = [], visibility: Int = 0) async throws -> APIPost {
        let mediaJSON = try encodeMedia(media)
        return try await client.request("/posts", method: "POST",
                                        body: ["content": content, "media": mediaJSON, "visibility": visibility],
                                        as: APIPost.self)
    }

    func toggleLike(postID: String, like: Bool) async throws -> APILikeResult {
        try await client.request("/posts/\(postID)/like", method: "POST",
                                 body: ["like": like], as: APILikeResult.self)
    }

    func deletePost(postID: String) async throws {
        try await client.requestVoid("/posts/\(postID)", method: "DELETE")
    }

    func comments(postID: String) async throws -> [APIComment] {
        try await client.request("/posts/\(postID)/comments", method: "GET", as: APICommentList.self).items
    }

    @discardableResult
    func addComment(postID: String, content: String) async throws -> APIComment {
        try await client.request("/posts/\(postID)/comments", method: "POST",
                                 body: ["content": content], as: APIComment.self)
    }

    // ================= 活动 =================

    @discardableResult
    func createPlan(title: String, summary: String, startsAt: Date, durationMinutes: Int,
                    participantLimit: Int, approximatePlace: String, privateMeetingPoint: String,
                    latitude: Double?, longitude: Double?, visibility: Int = 0) async throws -> APIPlan {
        var body: [String: Any] = [
            "title": title, "summary": summary,
            "startsAt": ISO8601DateFormatter().string(from: startsAt),
            "durationMinutes": durationMinutes, "participantLimit": participantLimit,
            "approximatePlace": approximatePlace, "privateMeetingPoint": privateMeetingPoint,
            "visibility": visibility
        ]
        if let latitude, let longitude { body["latitude"] = latitude; body["longitude"] = longitude }
        return try await client.request("/plans", method: "POST", body: body, as: APIPlan.self)
    }

    /// 附近活动发现
    func nearbyPlans(lat: Double, lng: Double, radiusMeters: Int = 5000, limit: Int = 30) async throws -> [APIPlan] {
        let q = ["lat": String(lat), "lng": String(lng),
                 "radius": String(radiusMeters), "limit": String(limit)]
        return try await client.request("/plans/nearby", method: "GET", query: q, as: APIPlanList.self).items
    }

    func myPlans() async throws -> [APIPlan] {
        try await client.request("/plans/mine", method: "GET", as: APIPlanList.self).items
    }

    func planDetail(id: String) async throws -> APIPlanDetail {
        try await client.request("/plans/\(id)", method: "GET", as: APIPlanDetail.self)
    }

    func applyToPlan(id: String) async throws {
        try await client.requestVoid("/plans/\(id)/apply", method: "POST", body: [:])
    }

    func respondToInvitation(planID: String, accept: Bool) async throws {
        try await client.requestVoid("/plans/\(planID)/respond", method: "POST", body: ["accept": accept])
    }

    func reviewApplication(planID: String, userID: String, approve: Bool) async throws {
        try await client.requestVoid("/plans/\(planID)/review", method: "POST",
                                     body: ["userId": userID, "approve": approve])
    }

    func inviteToPlan(planID: String, userID: String) async throws {
        try await client.requestVoid("/plans/\(planID)/invite", method: "POST", body: ["userId": userID])
    }

    func cancelPlan(id: String) async throws {
        try await client.requestVoid("/plans/\(id)", method: "DELETE")
    }

    // ================= 好友 =================

    func friends() async throws -> [APIFriend] {
        try await client.request("/friends", method: "GET", as: APIFriendList.self).items
    }

    func friendRequests() async throws -> [APIFriendRequest] {
        try await client.request("/friends/requests", method: "GET", as: APIFriendRequestList.self).items
    }

    func sendFriendRequest(userID: String) async throws {
        try await client.requestVoid("/friends/requests", method: "POST", body: ["userId": userID])
    }

    func respondToFriendRequest(requestID: String, accept: Bool) async throws {
        try await client.requestVoid("/friends/requests/\(requestID)/respond", method: "POST", body: ["accept": accept])
    }

    func blockUser(userID: String) async throws {
        try await client.requestVoid("/friends/block", method: "POST", body: ["userId": userID])
    }

    func report(targetType: Int, targetID: String, reason: Int) async throws {
        try await client.requestVoid("/friends/report", method: "POST",
                                     body: ["targetType": targetType, "targetId": targetID, "reason": reason])
    }

    // ================= 媒体 =================

    func requestUploadToken(fileType: String) async throws -> APIUploadToken {
        try await client.request("/media/upload-token", method: "POST",
                                 body: ["fileType": fileType], as: APIUploadToken.self)
    }

    // ---------- 工具 ----------
    private func encodeMedia(_ media: [APIMediaItem]) throws -> [[String: Any]] {
        let data = try JSONEncoder().encode(media)
        let arr = try JSONSerialization.jsonObject(with: data) as? [[String: Any]]
        return arr ?? []
    }
}
