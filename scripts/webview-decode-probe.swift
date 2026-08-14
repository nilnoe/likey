// S0 Spike 验证脚本：用系统 WKWebView（真实 WebKit 内核）实测
// decodeAudioData 对 mp3/flac/wav 的支持情况。
// 音频字节以 base64 内嵌页面（绕过网络/CORS），只测解码能力本身。
// 运行: swiftc -module-cache-path .swift-cache -o .swift-probe scripts/webview-decode-probe.swift && ./.swift-probe <fixture> <mime> [...]
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

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 2 else {
    FileHandle.standardError.write(
        "用法: swift-webview-probe <fixture 路径> <mime> [...]\n".data(using: .utf8)!
    )
    exit(2)
}

struct Probe {
    let name: String
    let mime: String
    let base64: String
}

var probes: [Probe] = []
var i = 0
while i < args.count {
    let path = args[i]
    let mime = i + 1 < args.count ? args[i + 1] : "application/octet-stream"
    let url = URL(fileURLWithPath: path)
    guard let data = try? Data(contentsOf: url) else {
        print("无法读取 \(path)")
        exit(2)
    }
    probes.append(Probe(name: url.lastPathComponent, mime: mime, base64: data.base64EncodedString()))
    i += 2
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

var pending = probes.count

for probe in probes {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent() // 不落盘
    let userContent = WKUserContentController()
    let messageHandler = MessageHandler { message in
        guard pending > 0 else { return }
        pending -= 1
        if let body = message.body as? [String: Any] {
            let ok = body["ok"] as? Bool ?? false
            if ok {
                let duration = body["duration"] as? Double ?? 0
                print("\(probe.name) [\(probe.mime)]: ✅ decodeAudioData 支持 (时长 \(String(format: "%.3f", duration))s)")
            } else {
                let error = body["error"] as? String ?? "未知错误"
                print("\(probe.name) [\(probe.mime)]: ❌ 失败: \(error)")
            }
        }
        if pending == 0 {
            exit(0)
        }
    }
    userContent.add(messageHandler, name: "result")
    config.userContentController = userContent

    let webView = WKWebView(
        frame: NSRect(x: 0, y: 0, width: 100, height: 100),
        configuration: config
    )
    let html = """
    <script>
    const b64 = '\(probe.base64)';
    const bin = atob(b64);
    const buf = new ArrayBuffer(bin.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
    const ctx = new OfflineAudioContext(1, 44100, 44100);
    ctx.decodeAudioData(buf).then(decoded => {
      window.webkit.messageHandlers.result.postMessage({ ok: true, duration: decoded.duration });
    }).catch(e => {
      window.webkit.messageHandlers.result.postMessage({ ok: false, error: String(e) });
    });
    </script>
    """
    webView.loadHTMLString(html, baseURL: nil)
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
        if pending > 0 {
            print("\(probe.name): ⏱ 超时（WebView 未返回结果）")
            pending -= 1
            if pending == 0 { exit(1) }
        }
    }
}

RunLoop.main.run(until: Date.distantFuture)
