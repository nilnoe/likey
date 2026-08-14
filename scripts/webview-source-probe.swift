// 音源运行时探测：在真实系统 WKWebView 中执行 .probe/source-probe.html，
// 验证 sandbox iframe 引导脚本 + fetch 代理 + RPC 的完整运行时契约。
// 前置：node scripts/generate-source-probe-html.mjs（从真实源码生成 HTML）
// 运行：swiftc -module-cache-path .swift-cache -o .swift-probe scripts/webview-source-probe.swift && ./.swift-probe
import Foundation
import WebKit

final class MessageHandler: NSObject, WKScriptMessageHandler {
    private let onMessage: (WKScriptMessage) -> Void
    init(onMessage: @escaping (WKScriptMessage) -> Void) {
        self.onMessage = onMessage
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        onMessage(message)
    }
}

guard let html = try? String(contentsOfFile: ".probe/source-probe.html", encoding: .utf8) else {
    FileHandle.standardError.write("缺少 .probe/source-probe.html（先运行 node scripts/generate-source-probe-html.mjs）\n".data(using: .utf8)!)
    exit(2)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()
let userContent = WKUserContentController()

var reports: [(step: String, ok: Bool, detail: String)] = []
var finished = false

func finishVerdict() {
    guard !finished else { return }
    finished = true
    let passed = reports.count >= 10 && reports.allSatisfy { $0.ok }
    print(passed && reports.count >= 10 ? "🎉 音源运行时契约全部通过（10/10）" : "⚠️ 探测未全部通过（\(reports.count)/10 项）")
    exit(passed && reports.count >= 10 ? 0 : 1)
}

let handler = MessageHandler { message in
    guard let body = message.body as? [String: Any] else { return }
    if let done = body["done"] as? Bool, done {
        finishVerdict()
    }
    if let step = body["step"] as? String {
        let ok = body["ok"] as? Bool ?? false
        let detail = body["detail"] as? String ?? ""
        reports.append((step: step, ok: ok, detail: detail))
        print("\(ok ? "✅" : "❌") \(step)\(detail.isEmpty ? "" : " — \(detail)")")
    }
}
userContent.add(handler, name: "result")
config.userContentController = userContent

let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 400, height: 300), configuration: config)
webView.loadHTMLString(html, baseURL: nil)

// 超时兜底（正常由 harness 的 done 消息触发判定）
DispatchQueue.main.asyncAfter(deadline: .now() + 40) {
    finishVerdict()
}

RunLoop.main.run(until: Date.distantFuture)
