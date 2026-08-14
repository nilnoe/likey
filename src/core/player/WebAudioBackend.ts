import type { DecodedBuffer, PlayerBackend, SourceHandle } from './PlayerBackend'

/**
 * 基于 Web Audio API 的真实播放后端。
 * 音频图：BufferSource → Analyser(fftSize 2048) → Gain → destination
 */
export class WebAudioBackend implements PlayerBackend {
  readonly context: AudioContext
  readonly analyser: AnalyserNode
  private readonly gain: GainNode

  constructor(context: AudioContext | null = null) {
    this.context = context ?? new AudioContext()
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.75
    this.gain = this.context.createGain()
    // 后级节点一次性接线；每个 Source 只需连到 analyser
    this.analyser.connect(this.gain)
    this.gain.connect(this.context.destination)
  }

  async decode(data: ArrayBuffer): Promise<DecodedBuffer> {
    return this.context.decodeAudioData(data)
  }

  createSource(buffer: DecodedBuffer, onEnded: () => void): SourceHandle {
    const source = this.context.createBufferSource()
    source.buffer = buffer as AudioBuffer
    source.connect(this.analyser)
    source.onended = () => {
      onEnded()
    }
    return {
      start: (offsetSeconds: number) => {
        source.start(0, offsetSeconds)
      },
      stop: () => {
        try {
          source.stop()
        } catch {
          // 未 start 或已自然结束：忽略
        }
      },
    }
  }

  setVolume(volume: number): void {
    this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.02)
  }
}
