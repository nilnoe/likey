import type { AnalyserLike } from '../analysis/SpectrumExtractor'

/** 解码后的音频缓冲（结构最小化，便于测试注入）。 */
export interface DecodedBuffer {
  readonly duration: number
}

/** 一次播放的源句柄。 */
export interface SourceHandle {
  start(offsetSeconds: number): void
  stop(): void
}

/**
 * 播放后端抽象：真实实现为 WebAudioBackend，单测注入 fake。
 * 播放内核只依赖此接口，与具体 Web Audio 实现解耦。
 */
export interface PlayerBackend {
  readonly context: {
    readonly currentTime: number
    readonly sampleRate: number
    resume(): Promise<void>
  }
  readonly analyser: AnalyserLike
  decode(data: ArrayBuffer): Promise<DecodedBuffer>
  createSource(buffer: DecodedBuffer, onEnded: () => void): SourceHandle
  setVolume(volume: number): void
}
