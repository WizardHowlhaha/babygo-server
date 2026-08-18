import Foundation

// ============================================================
// 后端接入配置(区分调试 / 生产环境,自动切换)
// ------------------------------------------------------------
// 调试(DEBUG)模式: 客户端请求本机后端 http://127.0.0.1:3000。
//   先在电脑上启动 babygo-server(npm run dev),模拟器即可直接联调。
//   真机调试请把 debugBaseURL 改成电脑的局域网 IP,如 http://192.168.1.10:3000。
// 生产(RELEASE)模式: 自动切换到正式服务域名 productionBaseURL。
//   上线前把 productionBaseURL 改成你申请的正式域名。
// ============================================================
enum BackendConfig {
    /// 调试环境后端地址(模拟器用 127.0.0.1;真机改成电脑局域网 IP)。
    static let debugBaseURL = URL(string: "http://127.0.0.1:3000")!

    /// 生产环境后端地址(上线前替换为正式域名)。
    static let productionBaseURL = URL(string: "https://api.yourbabygo.com")!

    /// 当前生效的后端地址: DEBUG 走本地端口,RELEASE 自动切换到生产域名。
    static var baseURL: URL {
        #if DEBUG
        return debugBaseURL
        #else
        return productionBaseURL
        #endif
    }

    /// 所有业务接口统一前缀
    static let apiPrefix = "/api"
}
