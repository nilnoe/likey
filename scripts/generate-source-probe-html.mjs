// 生成音源运行时探测 HTML（.probe/source-probe.html）：
// 从真实源码导入 SANDBOX_BOOTSTRAP_PRE/POST 与 example.js，
// 构建一个"迷你主线程 + 两个沙箱 iframe"的页面，
// 由 scripts/webview-source-probe.swift 在真实 WKWebView 中执行验证。
import { createServer } from 'vite'
import { mkdirSync, writeFileSync } from 'node:fs'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const { SANDBOX_BOOTSTRAP_PRE, SANDBOX_BOOTSTRAP_POST } = await server.ssrLoadModule(
  '/src/features/onlinesource/bootstrap.ts',
)
const exampleCode = (await server.ssrLoadModule('/public/sources/example.js?raw')).default

// fetch 代理专项测试音源：search 内部发起 fetch，验证代理请求/响应往返
const fetchTestCode = `
window.source = {
  search: function (keyword) {
    return fetch('http://probe.invalid/api/search?kw=' + keyword).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    }).then(function (data) {
      return data.songs
    })
  },
  getMusicUrl: function (songmid) {
    return 'https://example.com/' + songmid + '.mp3'
  },
  getLyric: function () {
    return null
  },
}
`

const harness = `
function report(step, ok, detail) {
  window.webkit.messageHandlers.result.postMessage({ step: step, ok: !!ok, detail: String(detail) })
}
function finish() {
  window.webkit.messageHandlers.result.postMessage({ done: true })
}
window.onerror = function (msg, source, line) {
  report('harness-error', false, msg + ' @' + source + ':' + line)
  finish()
}
report('harness-boot', true, '')
function escapeScript(code) {
  return String(code).replace(/<\\/script/gi, '<\\\\/script')
}
function makeFrame(code) {
  var iframe = document.createElement('iframe')
  iframe.sandbox.add('allow-scripts')
  iframe.style.display = 'none'
  iframe.srcdoc =
    '<!doctype html><html><head></head><body><script>' + escapeScript(code) + '<\\/script></body></html>'
  document.body.appendChild(iframe)
  return iframe
}

var exampleFrame = makeFrame(${JSON.stringify(SANDBOX_BOOTSTRAP_PRE)} + ${JSON.stringify(exampleCode)} + ${JSON.stringify(SANDBOX_BOOTSTRAP_POST)})
var fetchFrame = makeFrame(${JSON.stringify(SANDBOX_BOOTSTRAP_PRE)} + ${JSON.stringify(fetchTestCode)} + ${JSON.stringify(SANDBOX_BOOTSTRAP_POST)})

window.addEventListener('message', function (event) {
  var data = event.data
  if (!data || typeof data !== 'object') return

  if (event.source === exampleFrame.contentWindow) {
    if (data.type === 'ready') {
      report('example-ready', data.ok, data.error || '')
      if (data.ok) {
        exampleFrame.contentWindow.postMessage(
          { type: 'config', payload: [
            { id: 't1', title: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269, fileUrl: 'asset:///a.mp3' },
          ] },
          '*',
        )
        exampleFrame.contentWindow.postMessage(
          { type: 'call', callId: 'e1', method: 'search', args: ['晴天', 1, 30] },
          '*',
        )
      }
    } else if (data.type === 'call-result' && data.callId === 'e1') {
      var songs = data.ok ? data.value : null
      var valid = Array.isArray(songs) && songs.length === 1 && songs[0].songmid === 't1'
      report('example-search', data.ok && valid, JSON.stringify(songs))
      exampleFrame.contentWindow.postMessage(
        { type: 'call', callId: 'e2', method: 'getMusicUrl', args: ['t1', '320k'] },
        '*',
      )
    } else if (data.type === 'call-result' && data.callId === 'e2') {
      report('example-getMusicUrl', data.ok && data.value === 'asset:///a.mp3', String(data.value))
    }
  } else if (event.source === fetchFrame.contentWindow) {
    if (data.type === 'ready') {
      report('fetchtest-ready', data.ok, data.error || '')
      if (data.ok) {
        fetchFrame.contentWindow.postMessage(
          { type: 'call', callId: 'f1', method: 'search', args: ['杰伦'] },
          '*',
        )
      }
    } else if (data.type === 'fetch') {
      report(
        'fetch-proxy-request',
        data.url === 'http://probe.invalid/api/search?kw=杰伦',
        String(data.url),
      )
      var payload = JSON.stringify({ songs: [{ songmid: 'm1', name: '晴天' }] })
      var bytes = new TextEncoder().encode(payload)
      fetchFrame.contentWindow.postMessage(
        {
          type: 'fetch-response',
          fetchId: data.fetchId,
          ok: true,
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: bytes.buffer,
        },
        '*',
        [bytes.buffer],
      )
    } else if (data.type === 'call-result' && data.callId === 'f1') {
      var resultSongs = data.ok ? data.value : null
      report(
        'fetch-proxy-result',
        data.ok && Array.isArray(resultSongs) && resultSongs.length === 1 && resultSongs[0].songmid === 'm1',
        JSON.stringify(resultSongs),
      )
      finish()
    }
  }
})

setTimeout(function () {
  window.webkit.messageHandlers.result.postMessage({ done: true, timeout: true })
}, 20000)
`

const html = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>Likey 音源运行时探测</title></head>
  <body>
    <script>${harness}</script>
  </body>
</html>
`

mkdirSync('.probe', { recursive: true })
writeFileSync('.probe/source-probe.html', html)
await server.close()
console.log('已生成 .probe/source-probe.html')
