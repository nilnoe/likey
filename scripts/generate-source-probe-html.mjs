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
const audiusCode = (await server.ssrLoadModule('/public/sources/audius.js?raw')).default

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
var doneFlows = 0
function flowDone() {
  doneFlows += 1
  if (doneFlows >= 2) finish()
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
var audiusFrame = makeFrame(${JSON.stringify(SANDBOX_BOOTSTRAP_PRE)} + ${JSON.stringify(audiusCode)} + ${JSON.stringify(SANDBOX_BOOTSTRAP_POST)})

function respondFetch(frame, fetchId, ok, status, headers, body) {
  if (body) {
    frame.contentWindow.postMessage(
      { type: 'fetch-response', fetchId: fetchId, ok: ok, status: status, headers: headers, body: body },
      '*',
      [body],
    )
  } else {
    frame.contentWindow.postMessage(
      { type: 'fetch-response', fetchId: fetchId, ok: ok, status: status, headers: headers, body: undefined },
      '*',
    )
  }
}

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
      flowDone()
    }
  } else if (event.source === audiusFrame.contentWindow) {
    if (data.type === 'ready') {
      report('audius-ready', data.ok, data.error || '')
      if (data.ok) {
        audiusFrame.contentWindow.postMessage(
          { type: 'call', callId: 'a1', method: 'search', args: ['daft punk', 1, 5] },
          '*',
        )
      }
    } else if (data.type === 'fetch') {
      // 真实网络请求（Audius API 带 access-control-allow-origin: *）；
      // 脚本自定义 headers 不回传（浏览器 CORS 预检限制；真实应用走原生 HTTP 无此限制）
      window
        .fetch(data.url)
        .then(function (res) {
          return res.arrayBuffer().then(function (buf) {
            var headers = {}
            res.headers.forEach(function (value, key) {
              headers[key.toLowerCase()] = value
            })
            respondFetch(audiusFrame, data.fetchId, res.ok, res.status, headers, buf)
          })
        })
        .catch(function () {
          respondFetch(audiusFrame, data.fetchId, false, 0, {}, undefined)
        })
    } else if (data.type === 'call-result' && data.callId === 'a1') {
      var audiusSongs = data.ok ? data.value : null
      var audiusValid =
        Array.isArray(audiusSongs) &&
        audiusSongs.length >= 1 &&
        typeof audiusSongs[0].songmid === 'string' &&
        typeof audiusSongs[0].name === 'string' &&
        audiusSongs[0].name.length > 0
      report('audius-search-real', data.ok && audiusValid, JSON.stringify(audiusSongs).slice(0, 200))
      if (data.ok && audiusValid) {
        audiusFrame.contentWindow.postMessage(
          { type: 'call', callId: 'a2', method: 'getMusicUrl', args: [audiusSongs[0].songmid, '128k'] },
          '*',
        )
      } else {
        flowDone()
      }
    } else if (data.type === 'call-result' && data.callId === 'a2') {
      var streamUrl = data.ok ? data.value : null
      report(
        'audius-getMusicUrl-real',
        data.ok && typeof streamUrl === 'string' && streamUrl.indexOf('https://api.audius.co/v1/tracks/') === 0,
        String(streamUrl),
      )
      flowDone()
    }
  }
})

setTimeout(function () {
  window.webkit.messageHandlers.result.postMessage({ done: true, timeout: true })
}, 30000)
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
