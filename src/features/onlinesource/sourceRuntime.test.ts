import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SourceRuntime } from './SourceRuntime'

// 运行时对插件 HTTP 的动态导入在本测试中 mock（只测加载竞态，不测网络层）
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: async () => {
    throw new Error('mock: 不可用')
  },
}))

/**
 * SourceRuntime 加载竞态回归测试：
 * 用假定时器 + DOM 桩精确重放「启动时两次重叠 load」的时序——
 * 第一次 load 的遗留 10s 定时器到期时，不得清空第二次 load 的就绪状态。
 */

interface FakeIframe {
  contentWindow: object
  sandbox: { add: ReturnType<typeof vi.fn> }
  style: Record<string, string>
  srcdoc: string
  remove: ReturnType<typeof vi.fn>
}

interface Dom {
  readonly iframes: FakeIframe[]
  /** 已注册 message 监听（load 进入就绪等待）的次数。 */
  readonly registrationCount: () => number
  dispatchMessage(iframe: FakeIframe, data: unknown): void
}

const SOURCE_CODE = 'window.source={search:function(){return[]}}'

function makeDom(): Dom {
  const iframes: FakeIframe[] = []
  let messageHandler: ((event: { source: unknown; data: unknown }) => void) | null = null
  let registrations = 0
  vi.stubGlobal('window', {
    addEventListener: vi.fn(
      (_type: string, handler: (event: { source: unknown; data: unknown }) => void) => {
        messageHandler = handler
        registrations += 1
      },
    ),
    removeEventListener: vi.fn(() => {
      messageHandler = null
    }),
    setTimeout,
    clearTimeout,
  })
  vi.stubGlobal('document', {
    createElement: vi.fn(() => {
      const iframe: FakeIframe = {
        contentWindow: {},
        sandbox: { add: vi.fn() },
        style: {},
        srcdoc: '',
        remove: vi.fn(),
      }
      iframes.push(iframe)
      return iframe
    }),
    body: { appendChild: vi.fn() },
  })
  return {
    iframes,
    registrationCount: () => registrations,
    dispatchMessage: (iframe, data) => {
      messageHandler?.({ source: iframe.contentWindow, data })
    },
  }
}

/** 确定性等待：轮询到条件满足（微任务 + 零延迟定时器交替让出事件循环）。 */
async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(0)
  }
  throw new Error('waitUntil 超时：条件未满足')
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

describe('SourceRuntime 加载竞态', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('旧 load 的遗留定时器不清空新 load 的就绪状态（启动重叠回归）', async () => {
    const dom = makeDom()
    const runtime = new SourceRuntime()
    const statuses: string[] = []
    runtime.onStatus((status) => statuses.push(status))

    // 第一次 load（模拟面板首次挂载）
    const first = runtime.load(SOURCE_CODE)
    await waitUntil(() => dom.registrationCount() >= 1) // 进入就绪等待
    vi.advanceTimersByTime(5_000)

    // 第二次 load（模拟恢复用户音源后 sources 变化触发重载）→ 取代第一次
    const second = runtime.load(SOURCE_CODE)
    await waitUntil(() => dom.registrationCount() >= 2)
    // 越过第一次 load 的 10s 截止（未到第二次截止）：
    // 修复前：旧定时器在此清空 readyState → 杀掉第二次的等待；修复后：身份校验使其失效
    vi.advanceTimersByTime(6_000)

    // 第二次 iframe 此刻才返回 ready（主线程忙，略晚于旧超时点）
    dom.dispatchMessage(dom.iframes[1]!, { type: 'ready', ok: true })
    await flush()

    await second
    await first // 被取消的旧 load 静默收尾
    expect(runtime.getStatus()).toBe('ready')
    expect(statuses).toContain('ready')
    expect(statuses).not.toContain('error')
  })

  it('单次加载：ready 正常、真超时报 error', async () => {
    const dom = makeDom()
    const runtime = new SourceRuntime()

    const ok = runtime.load(SOURCE_CODE)
    await waitUntil(() => dom.registrationCount() >= 1)
    dom.dispatchMessage(dom.iframes[0]!, { type: 'ready', ok: true })
    await ok
    expect(runtime.getStatus()).toBe('ready')

    const timedOut = runtime.load(SOURCE_CODE)
    await waitUntil(() => dom.registrationCount() >= 2)
    vi.advanceTimersByTime(10_001)
    await expect(timedOut).rejects.toThrow('脚本初始化超时')
    expect(runtime.getStatus()).toBe('error')
  })

  it('被取消的旧 load 不污染状态（dispose 静默收尾）', async () => {
    const dom = makeDom()
    const runtime = new SourceRuntime()

    const first = runtime.load(SOURCE_CODE)
    await waitUntil(() => dom.registrationCount() >= 1)
    const second = runtime.load(SOURCE_CODE)
    await waitUntil(() => dom.registrationCount() >= 2)
    dom.dispatchMessage(dom.iframes[1]!, { type: 'ready', ok: true })
    await flush()

    await first
    await second
    expect(runtime.getStatus()).toBe('ready')
  })
})
