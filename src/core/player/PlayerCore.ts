import { Emitter } from '../events/emitter'
import type { DecodedBuffer, PlayerBackend, SourceHandle } from './PlayerBackend'

/** 播放器状态机（discriminated union，杜绝非法状态）。 */
export type PlayerStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly trackName: string }
  | { readonly kind: 'ready'; readonly trackName: string; readonly paused: true }
  | { readonly kind: 'playing'; readonly trackName: string }
  | { readonly kind: 'error'; readonly trackName: string; readonly message: string }

export interface PlayerCoreEvents {
  statusChange: PlayerStatus
  trackEnd: void
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

interface ActiveSource {
  readonly handle: SourceHandle
  manualStop: boolean
}

/**
 * 播放内核（纯 TS，无 DOM/React 依赖）。
 * 时间基：一切时间由 backend.context.currentTime 推导（单一音频时钟）。
 */
export class PlayerCore {
  private status: PlayerStatus = { kind: 'idle' }
  private buffer: DecodedBuffer | null = null
  private source: ActiveSource | null = null
  private startOffset = 0
  private startedAt = 0
  private volume = 1
  private readonly emitter = new Emitter<PlayerCoreEvents>()
  private readonly backend: PlayerBackend

  constructor(backend: PlayerBackend) {
    this.backend = backend
  }

  getStatus(): PlayerStatus {
    return this.status
  }

  getDuration(): number {
    return this.buffer?.duration ?? 0
  }

  getVolume(): number {
    return this.volume
  }

  /** 当前播放位置（秒），由音频时钟推导，非定时器累计。 */
  getPosition(): number {
    if (this.status.kind === 'playing') {
      return this.startOffset + (this.backend.context.currentTime - this.startedAt)
    }
    return this.startOffset
  }

  onStatusChange(callback: (status: PlayerStatus) => void): () => void {
    return this.emitter.on('statusChange', callback)
  }

  onTrackEnd(callback: () => void): () => void {
    return this.emitter.on('trackEnd', callback)
  }

  async load(trackName: string, data: ArrayBuffer): Promise<void> {
    this.stopSource()
    this.buffer = null
    this.startOffset = 0
    this.setStatus({ kind: 'loading', trackName })
    try {
      const buffer = await this.backend.decode(data)
      // 解码期间可能已被新的 load/stop 覆盖，丢弃过期结果
      if (this.status.kind !== 'loading' || this.status.trackName !== trackName) return
      this.buffer = buffer
      this.setStatus({ kind: 'ready', trackName, paused: true })
    } catch (error: unknown) {
      if (this.status.kind !== 'loading' || this.status.trackName !== trackName) return
      this.setStatus({ kind: 'error', trackName, message: describeError(error) })
    }
  }

  async play(): Promise<void> {
    if (this.buffer === null) return
    if (this.status.kind === 'playing') return
    const trackName =
      this.status.kind === 'ready' || this.status.kind === 'error' ? this.status.trackName : null
    if (trackName === null) return
    await this.backend.context.resume()
    this.createSource()
    this.startedAt = this.backend.context.currentTime
    this.setStatus({ kind: 'playing', trackName })
  }

  pause(): void {
    if (this.status.kind !== 'playing') return
    this.startOffset = this.getPosition()
    this.stopSource()
    this.setStatus({ kind: 'ready', trackName: this.status.trackName, paused: true })
  }

  stop(): void {
    this.stopSource()
    this.buffer = null
    this.startOffset = 0
    this.setStatus({ kind: 'idle' })
  }

  seek(seconds: number): void {
    if (this.buffer === null) return
    this.startOffset = clamp(seconds, 0, this.buffer.duration)
    if (this.status.kind === 'playing') {
      // 播放中 seek：重建 Source（BufferSource 为 one-shot，不能复用）
      this.stopSource()
      this.createSource()
      this.startedAt = this.backend.context.currentTime
    }
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1)
    this.backend.setVolume(this.volume)
  }

  private createSource(): void {
    if (this.buffer === null) return
    const offset = this.startOffset
    const source: ActiveSource = {
      handle: this.backend.createSource(this.buffer, () => {
        this.handleEnded(source)
      }),
      manualStop: false,
    }
    this.source = source
    source.handle.start(offset)
  }

  private handleEnded(endedSource: ActiveSource): void {
    if (this.source === endedSource) {
      this.source = null
    }
    if (endedSource.manualStop) return
    // 自然播完：回到就绪态，位置归零，通知队列推进
    this.startOffset = 0
    this.emitter.emit('trackEnd', undefined)
    if (this.status.kind === 'playing') {
      this.setStatus({ kind: 'ready', trackName: this.status.trackName, paused: true })
    }
  }

  private stopSource(): void {
    const source = this.source
    if (source === null) return
    source.manualStop = true
    this.source = null
    source.handle.stop()
  }

  private setStatus(status: PlayerStatus): void {
    this.status = status
    this.emitter.emit('statusChange', status)
  }
}
