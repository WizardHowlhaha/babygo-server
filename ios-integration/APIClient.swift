import Foundation
import OSLog
import Security

// ============================================================
// APIError: 网络层统一错误
// ============================================================
enum APIError: LocalizedError {
    case invalidURL
    case transport(Error)          // 网络不可达/超时等
    case decoding(Error)           // JSON 解析失败
    case server(status: Int, code: String, message: String)  // 后端返回 ok:false
    case unauthorized              // 401, 需要重新登录
    case notConfigured(String)     // 501, 第三方能力(微信等)未配置
    case tokenStorage(OSStatus)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "请求地址不合法"
        case let .transport(e): return "网络连接失败: \(e.localizedDescription)"
        case .decoding: return "数据解析失败, 请稍后重试"
        case let .server(_, _, message): return message
        case .unauthorized: return "登录已过期, 请重新登录"
        case let .notConfigured(message): return message
        case .tokenStorage: return "无法安全保存登录状态，请稍后重试"
        }
    }
}

// ============================================================
// APITokenStore: 把后端返回的 JWT 安全存进 Keychain
// (与保存会话摘要的 KeychainSessionStore 分开, 各存各的)
// ============================================================
final class APITokenStore {
    static let shared = APITokenStore()
    private let service: String
    private let account: String

    private(set) var token: String? {
        didSet { /* 内存缓存, 真实值以 Keychain 为准 */ }
    }

    init(service: String = "com.liuwenyu.babygo.api", account: String = "jwt-token") {
        self.service = service
        self.account = account
        token = nil
        token = readFromKeychain()
    }

    func save(_ jwt: String) throws {
        let data = Data(jwt.utf8)
        deleteFromKeychain()
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: data
        ]
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.liuwenyu.babygo", category: "authentication")
                .error("JWT Keychain save failed status=\(status, privacy: .public)")
            throw APIError.tokenStorage(status)
        }
        token = jwt
    }

    func clear() {
        token = nil
        deleteFromKeychain()
    }

    private func deleteFromKeychain() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }

    private func readFromKeychain() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

// ============================================================
// APIClient: 负责拼请求、带 token、发请求、解析统一响应外壳
// ============================================================
final class APIClient {
    static let shared = APIClient()

    private let session: URLSession
    private let decoder: JSONDecoder

    init(session: URLSession = .shared) {
        self.session = session
        self.decoder = JSONDecoder()
    }

    private enum Method: String { case GET, POST, DELETE }

    /// 发起请求并解析 { ok, data } 外壳, 返回 data。
    func request<T: Decodable>(
        _ path: String,
        method: String = "GET",
        query: [String: String] = [:],
        body: [String: Any]? = nil,
        authorized: Bool = true,
        as type: T.Type
    ) async throws -> T {
        // 组装 URL
        var comps = URLComponents(
            url: BackendConfig.baseURL.appendingPathComponent(BackendConfig.apiPrefix + path),
            resolvingAgainstBaseURL: false
        )
        if !query.isEmpty {
            comps?.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        guard let url = comps?.url else { throw APIError.invalidURL }

        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if authorized, let token = APITokenStore.shared.token {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        // 发送
        let requestID = UUID().uuidString
        req.setValue(requestID, forHTTPHeaderField: "X-Request-ID")
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.transport(error)
        }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        // 解析统一外壳
        let envelope: APIEnvelope<T>
        do {
            envelope = try decoder.decode(APIEnvelope<T>.self, from: data)
        } catch {
            // 无法按外壳解析: 根据状态码给出更明确错误
            if status == 401, authorized { throw APIError.unauthorized }
            throw APIError.decoding(error)
        }

        if envelope.ok, let payload = envelope.data {
            return payload
        }
        if envelope.ok, T.self == APIEmpty.self {
            return APIEmpty() as! T
        }

        // 失败分支
        let code = envelope.error?.code ?? "UNKNOWN"
        let message = envelope.error?.message ?? "请求失败"
        if status == 401, authorized { throw APIError.unauthorized }
        if status == 501 { throw APIError.notConfigured(message) }
        throw APIError.server(status: status, code: code, message: message)
    }

    /// 不关心返回体的请求(点赞/删除/审核等)
    func requestVoid(
        _ path: String,
        method: String = "POST",
        query: [String: String] = [:],
        body: [String: Any]? = nil,
        authorized: Bool = true
    ) async throws {
        _ = try await request(path, method: method, query: query, body: body, authorized: authorized, as: APIEmpty.self)
    }
}
