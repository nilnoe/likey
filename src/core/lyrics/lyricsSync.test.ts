import { describe, expect, it, vi } from 'vitest'
import { parseLrc } from './lrcParser'
import { LyricsSync } from './LyricsSync'

function makeSync(raw: string): LyricsSync {
  return new LyricsSync(parseLrc(raw))
}

describe('LyricsSync', () => {
  it('locates active line by binary search', () => {
    const sync = makeSync('[00:10.00]一\n[00:20.00]二\n[00:30.00]三')
    const onActive = vi.fn()
    sync.onActiveLine(onActive)
    sync.update(0)
    expect(onActive).not.toHaveBeenCalled() // 初始即 null，无变化不触发
    sync.update(10_000)
    expect(onActive).toHaveBeenLastCalledWith(0)
    sync.update(25_000)
    expect(onActive).toHaveBeenLastCalledWith(1)
    sync.update(30_001)
    expect(onActive).toHaveBeenLastCalledWith(2)
  })

  it('emits activeLine only on change', () => {
    const sync = makeSync('[00:10.00]一\n[00:20.00]二')
    const onActive = vi.fn()
    sync.onActiveLine(onActive)
    sync.update(11_000)
    sync.update(12_000)
    sync.update(13_000)
    expect(onActive).toHaveBeenCalledTimes(1)
  })

  it('applies file offset and user offset', () => {
    const sync = makeSync('[offset:+1000]\n[00:10.00]一')
    let active: number | null = -1
    sync.onActiveLine((i) => {
      active = i
    })
    sync.update(8_500) // 8.5s + 1s = 9.5s < 10s → 无行（初始 null 不触发回调）
    expect(active).toBe(-1)
    sync.setUserOffset(600) // 8.5s + 1s + 0.6s > 10s → 行 0
    expect(active).toBe(0)
    expect(sync.getUserOffset()).toBe(600)
  })

  it('interpolates per-char token progress', () => {
    const sync = makeSync('[00:10.00][00:10.50][00:11.00]一二三')
    const onProgress = vi.fn()
    sync.onTokenProgress(onProgress)
    sync.update(10_250) // 落在 token0 [10.0, 10.5) 区间中点
    expect(onProgress).toHaveBeenLastCalledWith({ lineIndex: 0, tokenIndex: 0, progress: 0.5 })
    sync.update(10_999) // token1 [10.5, 11.0) 尾段
    const last = onProgress.mock.calls.at(-1)?.[0]
    expect(last).toMatchObject({ tokenIndex: 1 })
    expect(last?.progress).toBeCloseTo(0.998)
  })

  it('single-token line reports line-level progress across its duration', () => {
    const sync = makeSync('[00:10.00]整行\n[00:20.00]下一行')
    const onProgress = vi.fn()
    sync.onTokenProgress(onProgress)
    sync.update(15_000) // 行中点
    expect(onProgress).toHaveBeenLastCalledWith({ lineIndex: 0, tokenIndex: 0, progress: 0.5 })
    sync.update(20_000)
    expect(onProgress).toHaveBeenLastCalledWith({ lineIndex: 1, tokenIndex: 0, progress: 0 })
  })

  it('emits null progress on reset', () => {
    const sync = makeSync('[00:10.00]一')
    const onProgress = vi.fn()
    sync.onTokenProgress(onProgress)
    sync.update(5_000)
    expect(onProgress).not.toHaveBeenCalled() // 初始即 null，无变化不触发
    sync.update(11_000)
    expect(onProgress).toHaveBeenCalled()
    sync.reset()
    expect(onProgress).toHaveBeenLastCalledWith(null)
  })

  it('throttles duplicate progress emissions', () => {
    const sync = makeSync('[00:10.00][00:11.00]一二')
    const onProgress = vi.fn()
    sync.onTokenProgress(onProgress)
    sync.update(10_500)
    sync.update(10_501) // 1ms 内 progress 变化 < 0.001 → 不重发
    expect(onProgress).toHaveBeenCalledTimes(1)
  })
})
