import { describe, expect, it, vi } from 'vitest'
import { WebAudioBackend } from './WebAudioBackend'

class FakeSource {
  buffer: unknown = null
  onended: (() => void) | null = null
  connectedTo: unknown = null
  readonly startedWith: Array<[number, number]> = []
  stopped = false

  connect(node: unknown): void {
    this.connectedTo = node
  }

  start(when: number, offset: number): void {
    this.startedWith.push([when, offset])
  }

  stop(): void {
    this.stopped = true
  }
}

interface FakeGraph {
  readonly context: Record<string, unknown>
  readonly sources: FakeSource[]
  readonly analyser: {
    fftSize: number
    smoothingTimeConstant: number
    connectCalls: number
    connect(): void
  }
  readonly gain: {
    gain: { setTargetAtTime: ReturnType<typeof vi.fn> }
    connectCalls: number
    connect(): void
  }
}

function makeFakeGraph(): FakeGraph {
  const sources: FakeSource[] = []
  const analyser = {
    fftSize: 0,
    smoothingTimeConstant: 0,
    connectCalls: 0,
    connect: (): void => {
      analyser.connectCalls += 1
    },
  }
  const gain = {
    gain: { setTargetAtTime: vi.fn() },
    connectCalls: 0,
    connect: (): void => {
      gain.connectCalls += 1
    },
  }
  const context: Record<string, unknown> = {
    currentTime: 1.25,
    state: 'running',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    createAnalyser: () => analyser,
    createGain: () => gain,
    createBufferSource: () => {
      const source = new FakeSource()
      sources.push(source)
      return source
    },
    destination: {},
    decodeAudioData: vi.fn(async (data: ArrayBuffer) => ({ duration: data.byteLength / 2 })),
  }
  return { context, sources, analyser, gain }
}

describe('WebAudioBackend', () => {
  it('wires the audio graph analyser → gain → destination', () => {
    const { context, analyser, gain } = makeFakeGraph()
    const backend = new WebAudioBackend(context as unknown as AudioContext)
    expect(backend.analyser.fftSize).toBe(2048)
    expect(backend.analyser.smoothingTimeConstant).toBeCloseTo(0.75)
    expect(analyser.connectCalls).toBe(1)
    expect(gain.connectCalls).toBe(1)
  })

  it('decodes via decodeAudioData', async () => {
    const { context } = makeFakeGraph()
    const backend = new WebAudioBackend(context as unknown as AudioContext)
    const buffer = await backend.decode(new ArrayBuffer(10))
    expect(buffer.duration).toBe(5)
  })

  it('creates one-shot sources wired to analyser with correct offsets', () => {
    const { context, sources } = makeFakeGraph()
    const backend = new WebAudioBackend(context as unknown as AudioContext)
    const ended = vi.fn()
    const handle = backend.createSource({ duration: 3 }, ended)
    handle.start(1.5)
    const source = sources[0]
    expect(source).toBeDefined()
    expect(source?.connectedTo).toBe(backend.analyser)
    expect(source?.startedWith).toEqual([[0, 1.5]])
    source?.onended?.()
    expect(ended).toHaveBeenCalledTimes(1)
    handle.stop()
    expect(source?.stopped).toBe(true)
  })

  it('setVolume drives gain with smoothing', () => {
    const { context, gain } = makeFakeGraph()
    const backend = new WebAudioBackend(context as unknown as AudioContext)
    backend.setVolume(0.5)
    expect(gain.gain.setTargetAtTime).toHaveBeenCalledWith(0.5, 1.25, 0.02)
  })

  it('onStateChange forwards context statechange with unsubscribe', () => {
    const { context } = makeFakeGraph()
    const backend = new WebAudioBackend(context as unknown as AudioContext)
    const callback = vi.fn()
    const unsubscribe = backend.onStateChange(callback)
    const addCalls = (context.addEventListener as ReturnType<typeof vi.fn>).mock.calls
    const handler = addCalls[0]?.[1] as () => void
    handler()
    expect(callback).toHaveBeenCalledWith('running')
    unsubscribe()
    expect(context.removeEventListener).toHaveBeenCalledWith('statechange', handler)
  })
})
