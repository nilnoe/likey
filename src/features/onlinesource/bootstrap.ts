/**
 * 沙箱引导脚本（字符串注入，主线程与音源脚本之间无依赖）。
 * 分段：PRE 在用户脚本前（fetch 代理 + RPC 监听），POST 在用户脚本后（ready 上报）。
 * 用户脚本协议：定义全局 window.source = { search, getMusicUrl, getLyric }。
 */
export const SANDBOX_BOOTSTRAP_PRE = `
;(function () {
  var nativeFetch = window.fetch.bind(window)
  var fetchPending = new Map()
  var fetchSeq = 0

  // fetch 代理：postMessage 到主线程（tauri-plugin-http 原生请求，免 CORS）
  window.fetch = function (url, options) {
    if (typeof url !== 'string') {
      return nativeFetch.apply(window, arguments)
    }
    options = options || {}
    return new Promise(function (resolve, reject) {
      var id = 'f' + (++fetchSeq)
      fetchPending.set(id, { resolve: resolve, reject: reject })
      var headers = {}
      if (options.headers) {
        if (typeof options.headers.forEach === 'function') {
          options.headers.forEach(function (value, key) {
            headers[key] = value
          })
        } else if (typeof options.headers === 'object') {
          for (var key in options.headers) headers[key] = options.headers[key]
        }
      }
      parent.postMessage(
        {
          type: 'fetch',
          fetchId: id,
          url: String(url),
          options: {
            method: options.method || 'GET',
            headers: headers,
            body: typeof options.body === 'string' ? options.body : undefined,
          },
        },
        '*',
      )
    })
  }

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || data.type === 'config') return
    if (data.type === 'fetch-response') {
      var entry = fetchPending.get(data.fetchId)
      if (!entry) return
      fetchPending.delete(data.fetchId)
      var headers = data.headers || {}
      var body = data.body
      entry.resolve({
        ok: !!data.ok,
        status: data.status,
        statusText: '',
        headers: {
          get: function (name) {
            var value = headers[String(name).toLowerCase()]
            return value === undefined ? null : value
          },
        },
        arrayBuffer: function () {
          return Promise.resolve(body)
        },
        text: function () {
          return Promise.resolve(new TextDecoder().decode(new Uint8Array(body)))
        },
        json: function () {
          return Promise.resolve(JSON.parse(new TextDecoder().decode(new Uint8Array(body))))
        },
      })
      return
    }
    if (data.type !== 'call') return
    var result = { type: 'call-result', callId: data.callId }
    try {
      var fn = window.source && window.source[data.method]
      if (typeof fn !== 'function') {
        throw new Error('音源未实现方法: ' + data.method)
      }
      Promise.resolve(fn.apply(window.source, data.args || [])).then(
        function (value) {
          result.ok = true
          result.value = value
          parent.postMessage(result, '*')
        },
        function (error) {
          result.ok = false
          result.error = String((error && error.message) || error)
          parent.postMessage(result, '*')
        },
      )
    } catch (error) {
      result.ok = false
      result.error = String((error && error.message) || error)
      parent.postMessage(result, '*')
    }
  })
})()
`

export const SANDBOX_BOOTSTRAP_POST = `
;(function () {
  if (window.source && typeof window.source === 'object') {
    parent.postMessage({ type: 'ready', ok: true }, '*')
  } else {
    parent.postMessage({ type: 'ready', ok: false, error: '脚本未定义全局 source 对象' }, '*')
  }
})()
`
