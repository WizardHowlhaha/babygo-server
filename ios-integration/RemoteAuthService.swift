import Foundation
import CryptoKit

// ============================================================
// RemoteAuthService: 登录/注册界面(AuthView)直连真实后端的唯一认证实现。
// 实现 App 的 AuthServicing 协议, 由 AppStore 默认注入。
//
// 说明:
//   - login / register(账号密码)已完全打通后端, 会真实建号并保存 JWT。
//   - register 的 code 参数在密码注册下被后端忽略, 保留仅为兼容协议。
//   - sendCode / 验证码登录 走后端短信服务; 短信未接入时后端桩固定验证码 123456。
//   - resetPassword 需要短信服务, 未接入前会给出明确提示。
// ============================================================
actor RemoteAuthService: AuthServicing {

    func sendCode(to rawPhone: String, purpose: VerificationPurpose) async throws {
        let phone = PhoneValidator.normalized(rawPhone)
        guard PhoneValidator.isValid(phone) else { throw AppServiceError.invalidPhone }
        do {
            _ = try await BabyGoAPI.shared.sendSMSCode(phone: phone, purpose: purpose.rawValue)
        } catch let e as APIError {
            throw Self.mapError(e)
        }
    }

    func login(phone rawPhone: String, password: String) async throws -> AppSession {
        let phone = PhoneValidator.normalized(rawPhone)
        guard PhoneValidator.isValid(phone) else { throw AppServiceError.invalidPhone }
        do {
            let user = try await BabyGoAPI.shared.login(phone: phone, password: password)
            return Self.makeSession(for: user)
        } catch let e as APIError {
            throw Self.mapError(e)
        }
    }

    func register(phone rawPhone: String, code: String, password: String) async throws -> AppSession {
        let phone = PhoneValidator.normalized(rawPhone)
        guard PhoneValidator.isValid(phone) else { throw AppServiceError.invalidPhone }
        guard PasswordValidator.isValid(password) else { throw AppServiceError.invalidPassword }
        _ = code // 密码注册无需验证码, 后端忽略; 保留参数以兼容协议
        do {
            let user = try await BabyGoAPI.shared.register(phone: phone, password: password, nickname: nil)
            return Self.makeSession(for: user)
        } catch let e as APIError {
            throw Self.mapError(e)
        }
    }

    func resetPassword(phone rawPhone: String, code: String, newPassword: String) async throws {
        // 找回密码依赖短信验证; 未接入短信服务前不提供该能力。
        throw AppServiceError.externalServiceRequired("找回密码需要短信服务, 请在后端接入短信后再使用。当前可用账号密码正常登录。")
    }

    func changePassword(phone rawPhone: String, oldPassword: String, newPassword: String) async throws {
        guard PasswordValidator.isValid(newPassword) else { throw AppServiceError.invalidPassword }
        do {
            try await BabyGoAPI.shared.changePassword(old: oldPassword, new: newPassword)
        } catch let e as APIError {
            throw Self.mapError(e)
        }
    }

    func loginWithCode(phone rawPhone: String, code: String) async throws -> AppSession {
        let phone = PhoneValidator.normalized(rawPhone)
        guard PhoneValidator.isValid(phone) else { throw AppServiceError.invalidPhone }
        do {
            let user = try await BabyGoAPI.shared.smsLogin(phone: phone, code: code)
            return Self.makeSession(for: user)
        } catch let e as APIError {
            throw Self.mapError(e)
        }
    }

    func loginWithWeChat() async throws -> AppSession {
        // 微信授权登录依赖微信开放平台应用配置; 未接入前给出明确提示。
        do {
            let user = try await BabyGoAPI.shared.wechatLogin(code: "")
            return Self.makeSession(for: user)
        } catch let e as APIError {
            throw Self.mapError(e)
        }
    }

    func checkUsername(_ rawUsername: String) async throws -> UsernameCheckResult {
        let username = UsernameValidator.normalized(rawUsername)
        guard UsernameValidator.isValid(username) else { throw AppServiceError.invalidUsername }
        do {
            let result = try await BabyGoAPI.shared.checkUsername(username)
            return UsernameCheckResult(available: result.available, suggestions: result.suggestions)
        } catch let e as APIError {
            throw Self.mapError(e)
        }
    }

    func registerWithUsername(username rawUsername: String, password: String) async throws -> AppSession {
        let username = UsernameValidator.normalized(rawUsername)
        guard UsernameValidator.isValid(username) else { throw AppServiceError.invalidUsername }
        guard PasswordValidator.isValid(password) else { throw AppServiceError.invalidPassword }
        do {
            let user = try await BabyGoAPI.shared.registerWithUsername(username: username, password: password)
            return Self.makeSession(for: user)
        } catch let e as APIError {
            throw Self.mapError(e)
        }
    }

    func loginWithUsername(username rawUsername: String, password: String) async throws -> AppSession {
        let username = UsernameValidator.normalized(rawUsername)
        guard UsernameValidator.isValid(username) else { throw AppServiceError.invalidUsername }
        do {
            let user = try await BabyGoAPI.shared.loginWithUsername(username: username, password: password)
            return Self.makeSession(for: user)
        } catch let e as APIError {
            throw Self.mapError(e)
        }
    }

    // ---------- 工具 ----------

    /// 后端用户 id 是整型字符串, App 内部用 UUID; 这里做一个稳定映射,
    /// 保证同一后端账号每次都得到相同 UUID。JWT 由 APITokenStore 单独保管。
    private static func makeSession(for user: APIUser) -> AppSession {
        AppSession(
            userID: UUID(stableFrom: "babygo-user-\(user.id)"),
            accessToken: APITokenStore.shared.token ?? "",
            expiresAt: Date().addingTimeInterval(60 * 60 * 24 * 30)
        )
    }

    private static func mapError(_ error: APIError) -> Error {
        switch error {
        case .unauthorized:
            return AppServiceError.wrongCredentials
        case let .notConfigured(message):
            return AppServiceError.externalServiceRequired(message)
        case let .server(_, code, message):
            switch code {
            case "PHONE_REGISTERED": return AppServiceError.phoneAlreadyRegistered
            case "ACCOUNT_NOT_FOUND": return AppServiceError.accountNotFound
            case "WRONG_CREDENTIALS": return AppServiceError.wrongCredentials
            case "INVALID_PHONE": return AppServiceError.invalidPhone
            case "INVALID_PASSWORD": return AppServiceError.invalidPassword
            case "INVALID_CODE": return AppServiceError.invalidCode
            case "INVALID_USERNAME": return AppServiceError.invalidUsername
            case "USERNAME_TAKEN": return AppServiceError.usernameAlreadyTaken
            case "BLOCKED_CONTENT": return AppServiceError.blockedContent
            default: return AppServiceError.externalServiceRequired(message)
            }
        default:
            return AppServiceError.externalServiceRequired(error.localizedDescription)
        }
    }
}

// 由任意字符串生成稳定 UUID(取 SHA256 前 16 字节)。
extension UUID {
    init(stableFrom string: String) {
        let hash = SHA256.hash(data: Data(string.utf8))
        var bytes = Array(hash.prefix(16))
        // 设置版本(4)与变体位, 使其成为合法 UUID 形态
        bytes[6] = (bytes[6] & 0x0F) | 0x40
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        let t = (bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                 bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15])
        self = UUID(uuid: t)
    }
}
