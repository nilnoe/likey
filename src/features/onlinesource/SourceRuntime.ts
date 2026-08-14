import {
  isSourceRuntimeMessage,
  parseLyricResult,
  parseSearchResult,
  parseUrlResult,
  type MusicQuality,
  type SourceRuntimeMessage,
  type SourceSong,
} from '../../core/onlinesource/protocol'
import { SANDBOX_BOOTSTRAP_PRE, SANDBOX_BOOTSTRAP_POST, escapeScriptCode } from './bootstrap'

type FetchMessage = Extract<SourceRuntimeMessage, { readonly type: 'fetch' }>

export type SourceRuntimeStatus = 'idle' | 'loading' | 'ready' | 'error'

const CALL_TIMEOUT_MS = 30_000
const READY_TIMEOUT_MS = 10_000

interface PendingCall {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: number
}

type PluginFetch = (input: string, init?: RequestInit) => Promise<Response>

/**
 * 音源脚本沙箱运行时：
 * - 脚本运行在 sandbox iframe（allow-scripts，无网络特权）
 * - 脚本内 fetch 经 postMessage 代理到主线程（tauri-plugin-http，免 CORS）
 * - RPC：search / getMusicUrl / getLyric，带超时与错误隔离
 */
export class SourceRuntime {
  private iframe: HTMLIFrameElement | null = null
  private callSeq = 0
  private pendingCalls = new Map<string, PendingCall>()
  private readyState: { resolve: () => void; reject: (e: Error) => void } | null = null
  private status: SourceRuntimeStatus = 'idle'
  private statusListeners = new Set<(status: SourceRuntimeStatus, error?: string) => void>()
  private pluginFetch: PluginFetch | null = null
  /** 加载代次：每次 load/dispose 递增；旧代的异步续作与定时器一律失效。 */
  private loadEpoch = 0
  private readonly handleMessage = (event: MessageEvent): void => {
    if (this.iframe === null || event.source !== this.iframe.contentWindow) return
    if (!isSourceRuntimeMessage(event.data)) return
    const message = event.data
    switch (message.type) {
      case 'ready': {
        const ready = this.readyState
        this.readyState = null
        if (ready === null) return
        if (message.ok) {
          ready.resolve()
        } else {
          ready.reject(new Error(message.error ?? '脚本初始化失败'))
        }
        break
      }
      case 'call-result': {
        const pending = this.pendingCalls.get(message.callId)
        if (pending === undefined) return
        this.pendingCalls.delete(message.callId)
        window.clearTimeout(pending.timer)
        if (message.ok) {
          pending.resolve(message.value)
        } else {
          pending.reject(new Error(message.error ?? '音源调用失败'))
        }
        break
      }
      case 'fetch': {
        void this.handleFetchProxy(message)
        break
      }
      default:
        break
    }
  }

  onStatus(callback: (status: SourceRuntimeStatus, error?: string) => void): () => void {
    this.statusListeners.add(callback)
    return () => {
      this.statusListeners.delete(callback)
    }
  }

  getStatus(): SourceRuntimeStatus {
    return this.status
  }

  /** 加载音源脚本（替换旧运行时）。加载代次机制保证重叠 load 互不干扰。 */
  async load(code: string): Promise<void> {
    this.dispose()
    const epoch = this.loadEpoch
    this.setStatus('loading')
    try {
      this.pluginFetch = await this.loadPluginFetch()
      if (epoch !== this.loadEpoch) return // 已被新加载取代
      // sandbox="allow-scripts"（不透明源）下 blob URL 不执行脚本（真实 WebKit 实测），
      // 必须用 srcdoc 内联；用户代码中的 </script> 需转义防止逃逸
      const escapedCode = escapeScriptCode(code)
      const srcdoc =
        '<!doctype html><html><head></head><body><script>' +
        SANDBOX_BOOTSTRAP_PRE +
        escapedCode +
        SANDBOX_BOOTSTRAP_POST +
        // eslint-disable-next-line no-useless-escape -- 防御性转义：防止 </script> 字面量进入任何内联脚本场景
        '<\/script></body></html>'
      const iframe = document.createElement('iframe')
      iframe.sandbox.add('allow-scripts')
      iframe.style.display = 'none'
      iframe.srcdoc = srcdoc
      document.body.appendChild(iframe)
      this.iframe = iframe
      window.addEventListener('message', this.handleMessage)

      await new Promise<void>((resolve, reject) => {
        let settled = false
        const settle = (ok: boolean, error?: Error): void => {
          if (settled) return
          settled = true
          if (ok) resolve()
          else reject(error ?? new Error('脚本初始化失败'))
        }
        let state: { resolve: () => void; reject: (e: Error) => void } | null = null
        const timer = window.setTimeout(() => {
          // 身份校验：仅当本代仍是当前就绪等待者才生效（旧代遗留定时器静默失效）
          if (this.readyState === state && state !== null) {
            this.readyState = null
            settle(false, new Error('脚本初始化超时（10s）'))
          }
        }, READY_TIMEOUT_MS)
        state = {
          resolve: () => {
            window.clearTimeout(timer)
            settle(true)
          },
          reject: (error) => {
            window.clearTimeout(timer)
            settle(false, error)
          },
        }
        this.readyState = state
      })
      if (epoch !== this.loadEpoch) return
      this.setStatus('ready')
    } catch (error: unknown) {
      if (epoch !== this.loadEpoch) return // 被取代的加载不污染状态
      this.setStatus('error', error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  /** 向脚本注入配置（如内置示例音源的本地曲库数据）。 */
  sendConfig(payload: unknown): void {
    this.iframe?.contentWindow?.postMessage({ type: 'config', payload }, '*')
  }

  async search(keyword: string, page = 1, limit = 30): Promise<SourceSong[]> {
    return parseSearchResult(await this.call('search', keyword, page, limit))
  }

  async getMusicUrl(songmid: string, quality: MusicQuality): Promise<string | null> {
    return parseUrlResult(await this.call('getMusicUrl', songmid, quality))
  }

  async getLyric(songmid: string): Promise<string | null> {
    return parseLyricResult(await this.call('getLyric', songmid))
  }

  dispose(): void {
    this.loadEpoch += 1 // 在途 load 全部失效
    window.removeEventListener('message', this.handleMessage)
    for (const pending of this.pendingCalls.values()) {
      window.clearTimeout(pending.timer)
    }
    this.pendingCalls.clear()
    const ready = this.readyState
    this.readyState = null
    ready?.reject(new Error('加载已取消')) // 让旧 load 的 await 正常收尾（其代次已失效，静默）
    this.iframe?.remove()
    this.iframe = null
    this.status = 'idle'
  }

  private call(method: string, ...args: unknown[]): Promise<unknown> {
    if (this.iframe === null) {
      return Promise.reject(new Error('音源未加载'))
    }
    const callId = `c${++this.callSeq}`
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pendingCalls.delete(callId)
        reject(new Error(`音源调用超时: ${method}`))
      }, CALL_TIMEOUT_MS)
      this.pendingCalls.set(callId, { resolve, reject, timer })
      this.iframe?.contentWindow?.postMessage({ type: 'call', callId, method, args }, '*')
    })
  }

  /** 脚本 fetch 代理：优先原生插件 HTTP（免 CORS），纯 Web 环境回退原生 fetch。 */
  private async handleFetchProxy(message: FetchMessage): Promise<void> {
    const respond = (
      ok: boolean,
      status: number,
      headers: Record<string, string>,
      body?: ArrayBuffer,
    ): void => {
      const payload = {
        type: 'fetch-response',
        fetchId: message.fetchId,
        ok,
        status,
        headers,
        body,
      }
      if (body !== undefined) {
        this.iframe?.contentWindow?.postMessage(payload, '*', [body])
      } else {
        this.iframe?.contentWindow?.postMessage(payload, '*')
      }
    }
    try {
      const fetchImpl = this.pluginFetch ?? ((input, init) => fetch(input, init))
      const init: RequestInit = {
        method: message.options?.method ?? 'GET',
        headers: message.options?.headers,
      }
      if (message.options?.body !== undefined) {
        init.body = message.options.body
      }
      const response = await fetchImpl(message.url, init)
      const body = await response.arrayBuffer()
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })
      respond(response.ok, response.status, headers, body)
    } catch {
      respond(false, 0, {})
    }
  }

  private async loadPluginFetch(): Promise<PluginFetch | null> {
    try {
      const module = await import('@tauri-apps/plugin-http')
      return (input: string, init?: RequestInit) =>
        module.fetch(input, init as Parameters<typeof module.fetch>[1])
    } catch {
      return null
    }
  }

  private setStatus(status: SourceRuntimeStatus, error?: string): void {
    this.status = status
    for (const listener of this.statusListeners) {
      listener(status, error)
    }
  }
}
