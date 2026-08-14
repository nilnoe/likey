import { Emitter } from '../events/emitter'
import type { PlayerStatus } from './PlayerCore'
import {
  advanceAuto,
  advanceManual,
  createShuffleOrder,
  defaultReadSource,
  retreatManual,
  type PlaylistTrack,
  type RepeatMode,
  type TrackRef,
  type TrackSource,
} from './Queue'

/** 控制器所依赖的播放内核最小接口（PlayerCore 天然满足，单测注入 fake）。 */
export interface QueuePlayer {
  load(track: TrackRef, data: ArrayBuffer): Promise<void>
  play(): Promise<void>
  stop(): void
  seek(seconds: number): void
  getStatus(): PlayerStatus
  onTrackEnd(callback: () => void): () => void
}

export interface QueueSnapshot {
  readonly tracks: readonly PlaylistTrack[]
  readonly index: number
  readonly repeat: RepeatMode
  readonly shuffle: boolean
}

export interface QueueControllerEvents {
  queueChange: void
  indexChange: number
  repeatChange: RepeatMode
  shuffleChange: boolean
  queueEnded: void
}

export interface QueueControllerOptions {
  /** 曲目字节读取（测试注入，默认 defaultReadSource）。 */
  readonly readSource?: (source: TrackSource) => Promise<ArrayBuffer>
  /** 洗牌种子来源（测试注入，默认随机）。 */
  readonly seedProvider?: () => number
}

const defaultSeedProvider = (): number => (Math.random() * 2 ** 31) | 0

/**
 * 播放队列控制器（纯 TS）：队列/洗牌/循环状态 + 播放内核调度。
 * 订阅 PlayerCore.trackEnd 自动推进；repeat='one' 重播当前曲；
 * repeat='off' 到底触发 queueEnded；手动切歌无条件回绕。
 */
export class QueueController {
  private tracks: PlaylistTrack[] = []
  private index = -1
  private repeat: RepeatMode = 'off'
  private shuffleEnabled = false
  private order: readonly number[] | null = null
  private readonly player: QueuePlayer
  private readonly readSource: (source: TrackSource) => Promise<ArrayBuffer>
  private readonly seedProvider: () => number
  private readonly emitter = new Emitter<QueueControllerEvents>()
  private readonly unsubscribeTrackEnd: () => void

  constructor(player: QueuePlayer, options: QueueControllerOptions = {}) {
    this.player = player
    this.readSource = options.readSource ?? defaultReadSource
    this.seedProvider = options.seedProvider ?? defaultSeedProvider
    this.unsubscribeTrackEnd = player.onTrackEnd(() => {
      void this.handleTrackEnd()
    })
  }

  getSnapshot(): QueueSnapshot {
    return {
      tracks: this.tracks,
      index: this.index,
      repeat: this.repeat,
      shuffle: this.shuffleEnabled,
    }
  }

  onQueueChange(callback: () => void): () => void {
    return this.emitter.on('queueChange', callback)
  }

  onIndexChange(callback: (index: number) => void): () => void {
    return this.emitter.on('indexChange', callback)
  }

  onRepeatChange(callback: (mode: RepeatMode) => void): () => void {
    return this.emitter.on('repeatChange', callback)
  }

  onShuffleChange(callback: (shuffle: boolean) => void): () => void {
    return this.emitter.on('shuffleChange', callback)
  }

  onQueueEnded(callback: () => void): () => void {
    return this.emitter.on('queueEnded', callback)
  }

  /** 追加文件；playFirst=true 且队列原本为空时立即播放第一首新曲。 */
  async addFiles(files: readonly File[], playFirst = false): Promise<void> {
    if (files.length === 0) return
    const firstIndex = this.tracks.length
    const tracks: PlaylistTrack[] = files.map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      source: { kind: 'file', file },
    }))
    this.tracks = [...this.tracks, ...tracks]
    this.refreshOrder()
    this.emitter.emit('queueChange', undefined)
    if (playFirst && this.index === -1) {
      await this.playIndex(firstIndex)
    }
  }

  /** 追加既有曲目（音乐库等）；按 id 去重。 */
  async addTracks(tracks: readonly PlaylistTrack[], playFirst = false): Promise<void> {
    if (tracks.length === 0) return
    const existing = new Set(this.tracks.map((t) => t.id))
    const fresh = tracks.filter((t) => !existing.has(t.id))
    if (fresh.length === 0) return
    const firstIndex = this.tracks.length
    this.tracks = [...this.tracks, ...fresh]
    this.refreshOrder()
    this.emitter.emit('queueChange', undefined)
    if (playFirst && this.index === -1) {
      await this.playIndex(firstIndex)
    }
  }

  async playIndex(i: number): Promise<void> {
    const track = this.tracks[i]
    if (track === undefined) return
    this.index = i
    this.emitter.emit('indexChange', i)
    const data = await this.readSource(track.source)
    if (this.index !== i) return // 读取期间用户已切曲
    await this.player.load({ id: track.id, name: track.name }, data)
    if (this.index !== i) return
    await this.player.play()
  }

  async next(): Promise<void> {
    const target = advanceManual(this.tracks.length, this.index, this.order)
    if (target !== null) {
      await this.playIndex(target)
    }
  }

  async prev(): Promise<void> {
    const target = retreatManual(this.tracks.length, this.index, this.order)
    if (target !== null) {
      await this.playIndex(target)
    }
  }

  setRepeat(mode: RepeatMode): void {
    this.repeat = mode
    this.emitter.emit('repeatChange', mode)
  }

  toggleShuffle(): void {
    this.shuffleEnabled = !this.shuffleEnabled
    this.refreshOrder()
    this.emitter.emit('shuffleChange', this.shuffleEnabled)
  }

  removeAt(i: number): void {
    const track = this.tracks[i]
    if (track === undefined) return
    const wasCurrent = i === this.index
    this.tracks = this.tracks.filter((_, idx) => idx !== i)
    if (this.index > i) {
      this.index -= 1
    } else if (wasCurrent) {
      this.player.stop()
      this.index = this.tracks.length === 0 ? -1 : Math.min(i, this.tracks.length - 1)
      this.emitter.emit('indexChange', this.index)
    }
    this.refreshOrder()
    this.emitter.emit('queueChange', undefined)
  }

  clear(): void {
    this.tracks = []
    this.index = -1
    this.order = null
    this.player.stop()
    this.emitter.emit('indexChange', -1)
    this.emitter.emit('queueChange', undefined)
  }

  dispose(): void {
    this.unsubscribeTrackEnd()
  }

  private refreshOrder(): void {
    this.order = this.shuffleEnabled
      ? createShuffleOrder(this.tracks.length, this.seedProvider())
      : null
  }

  private async handleTrackEnd(): Promise<void> {
    if (this.index === -1) return
    if (this.repeat === 'one') {
      await this.player.play()
      return
    }
    const target = advanceAuto(this.tracks.length, this.index, this.order, this.repeat)
    if (target === null) {
      this.emitter.emit('queueEnded', undefined)
      return
    }
    await this.playIndex(target)
  }
}
