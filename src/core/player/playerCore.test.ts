import { describe, expect, it, vi } from 'vitest'
import { PlayerCore, clamp, describeError, pickCacheCapacity } from './PlayerCore'
import type { DecodedBuffer, PlayerBackend, SourceHandle } from './PlayerBackend'

class FakeSource implements SourceHandle {
  readonly started: number[] = []
  stopped = false
  private readonly ended: () => void

  constructor(ended: () => void) {
    this.ended = ended
  }

  start(offsetSeconds: number): void {
    this.started.push(offsetSeconds)
  }

  stop(): void {
    this.stopped = true
  }

  fireEnded(): void {
    this.ended()
  }
}

interface PendingDecode {
  readonly data: ArrayBuffer
  resolve(buffer: DecodedBuffer): void
  reject(error: Error): void
}

class FakeBackend implements PlayerBackend {
  now = 0
  volume = -1
  resumeCalls = 0
  readonly sources: FakeSource[] = []
  readonly pending: PendingDecode[] = []
  readonly analyser = {
    fftSize: 2048,
    frequencyBinCount: 1024,
    getByteFrequencyData(array: Uint8Array): void {
      array.fill(0)
    },
    getByteTimeDomainData(array: Uint8Array): void {
      array.fill(128)
    },
  }

  get context() {
    return {
      currentTime: this.now,
      sampleRate: 44100,
      resume: async (): Promise<void> => {
        this.resumeCalls += 1
      },
    }
  }

  decode(data: ArrayBuffer): Promise<DecodedBuffer> {
    return new Promise((resolve, reject) => {
      this.pending.push({ data, resolve, reject })
    })
  }

  createSource(_buffer: DecodedBuffer, onEnded: () => void): SourceHandle {
    const source = new FakeSource(onEnded)
    this.sources.push(source)
    return source
  }

  setVolume(volume: number): void {
    this.volume = volume
  }
}

async function loadedCore(
  backend: FakeBackend,
  track: { id: string; name: string } = { id: 't1', name: 'track.mp3' },
  duration = 10,
): Promise<PlayerCore> {
  const core = new PlayerCore(backend)
  const loading = core.load(track, new ArrayBuffer(1))
  backend.pending[0]?.resolve({ duration })
  await loading
  return core
}

describe('clamp / describeError', () => {
  it('clamps into range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
  })

  it('describes errors', () => {
    expect(describeError(new Error('boom'))).toBe('boom')
    expect(describeError('plain')).toBe('plain')
  })
})

describe('pickCacheCapacity', () => {
  it('drops to 1 on low-memory devices', () => {
    expect(pickCacheCapacity(undefined)).toBe(2)
    expect(pickCacheCapacity(2)).toBe(1)
    expect(pickCacheCapacity(3.5)).toBe(1)
    expect(pickCacheCapacity(4)).toBe(2)
    expect(pickCacheCapacity(16)).toBe(2)
  })
})

describe('PlayerCore', () => {
  it('load → ready, exposes duration and volume defaults', async () => {
    const backend = new FakeBackend()
    const core = await loadedCore(backend)
    expect(core.getStatus()).toEqual({ kind: 'ready', trackName: 'track.mp3', paused: true })
    expect(core.getDuration()).toBe(10)
    expect(core.getPosition()).toBe(0)
    expect(core.getVolume()).toBe(1)
  })

  it('load failure → error status with message', async () => {
    const backend = new FakeBackend()
    const core = new PlayerCore(backend)
    const loading = core.load({ id: 'bad', name: 'bad.mp3' }, new ArrayBuffer(1))
    backend.pending[0]?.reject(new Error('decode boom'))
    await loading
    expect(core.getStatus()).toEqual({
      kind: 'error',
      trackName: 'bad.mp3',
      message: 'decode boom',
    })
  })

  it('cache hit avoids re-decode for the same track id', async () => {
    const backend = new FakeBackend()
    const core = await loadedCore(backend, { id: 't1', name: 'track.mp3' })
    await core.load({ id: 't1', name: 'track.mp3' }, new ArrayBuffer(1))
    expect(backend.pending).toHaveLength(1) // 无第二次解码
    expect(core.getStatus()).toEqual({ kind: 'ready', trackName: 'track.mp3', paused: true })
    expect(core.getDuration()).toBe(10)
  })

  it('different track id decodes again', async () => {
    const backend = new FakeBackend()
    const core = await loadedCore(backend, { id: 't1', name: 'a.mp3' })
    const loading = core.load({ id: 't2', name: 'b.mp3' }, new ArrayBuffer(2))
    backend.pending[1]?.resolve({ duration: 20 })
    await loading
    expect(backend.pending).toHaveLength(2)
    expect(core.getDuration()).toBe(20)
  })

  it('stale load result is discarded when superseded', async () => {
    const backend = new FakeBackend()
    const core = new PlayerCore(backend)
    const first = core.load({ id: 'a', name: 'a.mp3' }, new ArrayBuffer(1))
    const second = core.load({ id: 'b', name: 'b.mp3' }, new ArrayBuffer(2))
    backend.pending[1]?.resolve({ duration: 200 })
    await second
    backend.pending[0]?.resolve({ duration: 100 })
    await first
    expect(core.getStatus()).toEqual({ kind: 'ready', trackName: 'b.mp3', paused: true })
    expect(core.getDuration()).toBe(200)
  })

  it('play/pause freeze position on the audio clock', async () => {
    const backend = new FakeBackend()
    const core = await loadedCore(backend)
    await core.play()
    expect(core.getStatus()).toEqual({ kind: 'playing', trackName: 'track.mp3' })
    expect(backend.resumeCalls).toBe(1)
    backend.now = 1
    expect(core.getPosition()).toBeCloseTo(1)
    core.pause()
    expect(core.getStatus()).toEqual({ kind: 'ready', trackName: 'track.mp3', paused: true })
    backend.now = 5
    expect(core.getPosition()).toBeCloseTo(1) // 暂停后位置冻结
    await core.play()
    backend.now = 7
    expect(core.getPosition()).toBeCloseTo(3) // 1 + (7-5)
  })

  it('play is idempotent and no-ops without buffer', async () => {
    const backend = new FakeBackend()
    const core = new PlayerCore(backend)
    await core.play()
    expect(core.getStatus()).toEqual({ kind: 'idle' })
    expect(backend.resumeCalls).toBe(0)
    const loaded = await loadedCore(backend)
    await loaded.play()
    await loaded.play()
    expect(loaded.getStatus().kind).toBe('playing')
    expect(backend.sources).toHaveLength(1)
  })

  it('seek while paused moves position without creating source', async () => {
    const backend = new FakeBackend()
    const core = await loadedCore(backend)
    core.seek(5)
    expect(core.getPosition()).toBe(5)
    expect(backend.sources).toHaveLength(0)
  })

  it('seek while playing rebuilds source at new offset and clamps', async () => {
    const backend = new FakeBackend()
    const core = await loadedCore(backend)
    await core.play()
    backend.now = 2
    core.seek(7)
    expect(core.getPosition()).toBeCloseTo(7)
    expect(backend.sources[0]?.stopped).toBe(true)
    expect(backend.sources[1]?.started).toEqual([7])
    core.seek(100)
    expect(core.getPosition()).toBeCloseTo(10) // clamp 到时长
    core.seek(-5)
    expect(core.getPosition()).toBeCloseTo(0)
  })

  it('natural end fires trackEnd and resets position', async () => {
    const backend = new FakeBackend()
    const core = await loadedCore(backend)
    const onEnd = vi.fn()
    core.onTrackEnd(onEnd)
    await core.play()
    backend.now = 3
    backend.sources[0]?.fireEnded()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(core.getStatus()).toEqual({ kind: 'ready', trackName: 'track.mp3', paused: true })
    expect(core.getPosition()).toBe(0)
  })

  it('manual stop (pause) does not fire trackEnd', async () => {
    const backend = new FakeBackend()
    const core = await loadedCore(backend)
    const onEnd = vi.fn()
    core.onTrackEnd(onEnd)
    await core.play()
    core.pause()
    backend.sources[0]?.fireEnded() // stop 后 Web Audio 仍会回调 onended
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('stop resets to idle and clears buffer', async () => {
    const backend = new FakeBackend()
    const core = await loadedCore(backend)
    core.stop()
    expect(core.getStatus()).toEqual({ kind: 'idle' })
    expect(core.getDuration()).toBe(0)
  })

  it('setVolume clamps and forwards', async () => {
    const backend = new FakeBackend()
    const core = await loadedCore(backend)
    core.setVolume(0.5)
    expect(backend.volume).toBe(0.5)
    core.setVolume(2)
    expect(backend.volume).toBe(1)
    core.setVolume(-1)
    expect(backend.volume).toBe(0)
  })
})

/** 支持上下文状态变化（挂起/恢复）的 fake 后端。 */
class StatefulFakeBackend extends FakeBackend {
  state: 'running' | 'suspended' = 'running'
  private stateCallbacks: Array<(state: string) => void> = []

  onStateChange(callback: (state: string) => void): () => void {
    this.stateCallbacks.push(callback)
    return () => {
      this.stateCallbacks = this.stateCallbacks.filter((cb) => cb !== callback)
    }
  }

  emitState(state: string): void {
    this.state = state as 'running' | 'suspended'
    for (const cb of this.stateCallbacks) {
      cb(state)
    }
  }

  get context() {
    return {
      currentTime: this.now,
      sampleRate: 44100,
      resume: async (): Promise<void> => {
        this.resumeCalls += 1
        if (this.state === 'suspended') {
          this.emitState('running') // 真实 AudioContext.resume 会触发 statechange
        }
      },
    }
  }
}

/** resume 可控挂起的 fake 后端（模拟系统自行恢复场景）。 */
class DeferredResumeFakeBackend extends StatefulFakeBackend {
  resumeResolver: (() => void) | null = null

  get context() {
    return {
      currentTime: this.now,
      sampleRate: 44100,
      resume: (): Promise<void> => {
        this.resumeCalls += 1
        return new Promise<void>((resolve) => {
          this.resumeResolver = resolve
        })
      },
    }
  }
}

describe('PlayerCore 上下文挂起恢复', () => {
  it('suspension during playback freezes position and rebuilds after resume', async () => {
    const backend = new StatefulFakeBackend()
    const core = await loadedCore(backend)
    await core.play()
    backend.now = 3
    backend.emitState('suspended')
    expect(backend.sources[0]?.stopped).toBe(true) // 旧源已停
    expect(core.getPosition()).toBeCloseTo(3) // 位置冻结
    expect(core.getStatus().kind).toBe('playing')
    backend.now = 5
    expect(backend.sources[1]?.started).toEqual([3]) // 按冻结位置重建
    expect(core.getPosition()).toBeCloseTo(5)
  })

  it('suspension while paused is ignored', async () => {
    const backend = new StatefulFakeBackend()
    const core = await loadedCore(backend)
    core.seek(2)
    backend.emitState('suspended')
    expect(backend.sources).toHaveLength(0)
    expect(core.getStatus()).toMatchObject({ kind: 'ready' })
    expect(backend.resumeCalls).toBe(0)
  })

  it('running event rebuilds source when missing (external resume)', async () => {
    const backend = new DeferredResumeFakeBackend()
    const core = await loadedCore(backend)
    const playPromise = core.play()
    backend.resumeResolver?.() // 完成首次 resume
    await playPromise
    expect(core.getStatus().kind).toBe('playing')
    backend.now = 2
    backend.emitState('suspended') // 恢复流程挂起在 resume，源已同步停止
    expect(backend.sources[0]?.stopped).toBe(true)
    backend.emitState('running') // 系统自行恢复 → running 分支重建
    expect(backend.sources[1]?.started).toEqual([2])
    backend.now = 4
    expect(core.getPosition()).toBeCloseTo(4)
    backend.resumeResolver?.() // 迟到的 resume 完成 → 因源已存在不再重建
    await Promise.resolve()
    expect(backend.sources).toHaveLength(2)
  })
})
