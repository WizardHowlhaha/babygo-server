import Foundation

// ============================================================
// 后端 JSON 对应的数据模型 (DTO)
// 后端统一返回 { "ok": true, "data": ... } 或 { "ok": false, "error": {...} }
// 这些类型只服务于网络层, 与 App 现有的 DomainModels 解耦,
// 方便你按自己的节奏逐步接入, 不会破坏现有本地逻辑。
// ============================================================

/// 后端错误体
struct APIErrorBody: Decodable {
    let code: String
    let message: String
}

/// 统一响应外壳
struct APIEnvelope<T: Decodable>: Decodable {
    let ok: Bool
    let data: T?
    let error: APIErrorBody?

    private enum CodingKeys: String, CodingKey {
        case ok
        case data
        case error
        case code
        case message
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ok = try container.decode(Bool.self, forKey: .ok)
        data = try container.decodeIfPresent(T.self, forKey: .data)

        if let nestedError = try container.decodeIfPresent(APIErrorBody.self, forKey: .error) {
            error = nestedError
        } else if let code = try container.decodeIfPresent(String.self, forKey: .code),
                  let message = try container.decodeIfPresent(String.self, forKey: .message) {
            error = APIErrorBody(code: code, message: message)
        } else {
            error = nil
        }
    }
}

/// 无数据返回时的占位类型 (例如点赞/删除)
struct APIEmpty: Decodable {}

// ---------- 用户 / 会话 ----------
struct APIUser: Decodable, Identifiable, Equatable {
    let id: String
    let phone: String?
    let username: String?
    let nickname: String
    let avatar: String
    let bio: String?
    let city: String?
    let isVerified: Bool
    let isWeChatBound: Bool?
}

struct APISessionPayload: Decodable {
    let token: String
    let user: APIUser
}

/// 用户名查重结果 (POST /auth/check-username)
struct APIUsernameCheck: Decodable {
    let available: Bool
    let suggestions: [String]
}

struct APISendCodeResult: Decodable {
    let smsConfigured: Bool
    let devCode: String?   // 桩模式返回 "123456", 接真实短信后为 null
    let message: String
}

// ---------- 动态 ----------
struct APIMediaItem: Codable, Equatable {
    let type: String       // "image" | "video"
    let url: String
    var cover: String?
    var width: Int?
    var height: Int?
    var duration: Double?
}

struct APIPostAuthor: Decodable, Equatable {
    let id: String
    let nickname: String
    let avatar: String
    let isVerified: Bool
}

struct APIPost: Decodable, Identifiable, Equatable {
    let id: String
    let author: APIPostAuthor
    let content: String
    let media: [APIMediaItem]
    let likeCount: Int
    let commentCount: Int
    let liked: Bool
    let visibility: Int
    let createdAt: String
    let isMine: Bool
}

struct APIFeedPage: Decodable {
    let items: [APIPost]
    let nextCursor: String?
}

struct APILikeResult: Decodable {
    let liked: Bool
    let likeCount: Int
}

struct APIComment: Decodable, Identifiable, Equatable {
    let id: String
    let author: APIPostAuthor?
    let content: String
    let createdAt: String
}

struct APICommentList: Decodable { let items: [APIComment] }

// ---------- 活动 ----------
struct APIPlan: Decodable, Identifiable, Equatable {
    let id: String
    let owner: APIPostAuthor
    let title: String
    let summary: String
    let startsAt: String
    let durationMinutes: Int
    let participantLimit: Int
    let approximatePlace: String
    let privateMeetingPoint: String?  // 非成员为 null
    let latitude: Double?
    let longitude: Double?
    let visibility: Int
    let acceptedCount: Int?
    let distanceMeters: Int?
    let status: Int
    let isMine: Bool
    let myMemberStatus: Int?           // 0被邀请 1申请中 2已通过 / null
    let createdAt: String
}

struct APIPlanList: Decodable { let items: [APIPlan] }

struct APIPlanMember: Decodable, Identifiable {
    let id: String
    let nickname: String
    let avatar: String
    let isVerified: Bool
    let status: Int
}

struct APIPlanDetail: Decodable {
    let plan: APIPlan
    let members: [APIPlanMember]
}

// ---------- 好友 ----------
struct APIFriend: Decodable, Identifiable, Equatable {
    let id: String
    let nickname: String
    let avatar: String
    let bio: String?
    let city: String?
    let isVerified: Bool
}

struct APIFriendList: Decodable { let items: [APIFriend] }

struct APIFriendRequest: Decodable, Identifiable {
    var id: String { requestId }
    let requestId: String
    let createdAt: String
    let from: APIFriend
}

struct APIFriendRequestList: Decodable { let items: [APIFriendRequest] }

// ---------- 媒体上传凭证 ----------
struct APIUploadToken: Decodable {
    let configured: Bool
    let message: String?
    let objectKey: String
    let uploadUrl: String?
    let publicUrl: String?
    let fileType: String
}

// ---------- 健康检查 / 能力开关 ----------
struct APIHealthFeatures: Decodable {
    let sms: Bool
    let wechat: Bool
    let oss: Bool
}

struct APIHealth: Decodable {
    let ok: Bool
    let env: String
    let db: String
    let features: APIHealthFeatures
}
