import { Emitter } from '../events/emitter'
import type { LrcDocument, LyricLine } from './lrcParser'

export interface TokenProgress {
  readonly lineIndex: number
  readonly tokenIndex: number
  readonly progress: number
}

export interface LyricsSyncEvents {
  activeLine: number | null
  tokenProgress: TokenProgress | null
}

/**
 * 歌词同步引擎（纯 TS）：
 * - 二分查找定位当前行（O(log n)）
 * - 总偏移 = 文件 offset + 用户校准 offset
 * - 逐字进度按 token 时间线性插值，输出 0..1
 */
export class LyricsSync {
  private readonly lines: readonly LyricLine[]
  private readonly baseOffsetMs: number
  private userOffsetMs = 0
  private activeIndex: number | null = null
  private lastProgressKey = ''
  private lastPositionMs = 0
  private readonly emitter = new Emitter<LyricsSyncEvents>()

  constructor(document: LrcDocument) {
    this.lines = document.lines
    this.baseOffsetMs = document.offsetMs
  }

  onActiveLine(callback: (index: number | null) => void): () => void {
    return this.emitter.on('activeLine', callback)
  }

  onTokenProgress(callback: (progress: TokenProgress | null) => void): () => void {
    return this.emitter.on('tokenProgress', callback)
  }

  /** 用户校准偏移（±ms，持久化由上层负责）。 */
  setUserOffset(ms: number): void {
    this.userOffsetMs = ms
    this.update(this.lastPositionMs)
  }

  getUserOffset(): number {
    return this.userOffsetMs
  }

  update(positionMs: number): void {
    this.lastPositionMs = positionMs
    const pos = positionMs + this.baseOffsetMs + this.userOffsetMs
    const index = this.findActive(pos)
    if (index !== this.activeIndex) {
      this.activeIndex = index
      this.emitter.emit('activeLine', index)
    }
    if (index === null) {
      if (this.lastProgressKey !== '') {
        this.lastProgressKey = ''
        this.emitter.emit('tokenProgress', null)
      }
      return
    }
    const line = this.lines[index]
    if (line === undefined) return
    // 单 token 行 → 行级进度（跨整行时长）；多 token 行 → 逐字插值
    const progress =
      line.tokens.length === 1
        ? this.computeLineProgress(index, pos)
        : this.computeTokenProgress(line, pos)
    const key = `${progress.tokenIndex}:${progress.progress.toFixed(2)}`
    if (key !== this.lastProgressKey) {
      this.lastProgressKey = key
      this.emitter.emit('tokenProgress', progress)
    }
  }

  reset(): void {
    this.activeIndex = null
    this.lastProgressKey = ''
    this.emitter.emit('activeLine', null)
    this.emitter.emit('tokenProgress', null)
  }

  /** 二分查找：最后一个 start <= pos 的行。 */
  private findActive(pos: number): number | null {
    if (this.lines.length === 0) return null
    if ((this.lines[0]?.start ?? 0) > pos) return null
    let lo = 0
    let hi = this.lines.length - 1
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if ((this.lines[mid]?.start ?? 0) <= pos) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }
    return lo
  }

  private computeLineProgress(index: number, pos: number): TokenProgress {
    const line = this.lines[index]
    const next = this.lines[index + 1]
    const start = line?.start ?? 0
    // 末行无后继时间戳 → 标称 3s 时长，填充动画仍可进行
    const end = next?.start ?? start + 3000
    const progress = Math.min(1, Math.max(0, (pos - start) / (end - start)))
    return { lineIndex: index, tokenIndex: 0, progress }
  }

  private computeTokenProgress(line: LyricLine, pos: number): TokenProgress {
    const tokens = line.tokens
    let tokenIndex = 0
    for (let i = 0; i < tokens.length; i++) {
      const time = tokens[i]?.time ?? 0
      if (time <= pos) {
        tokenIndex = i
      } else {
        break
      }
    }
    const token = tokens[tokenIndex]
    const next = tokens[tokenIndex + 1]
    const tokenTime = token?.time ?? 0
    const progress =
      next === undefined ? 1 : Math.min(1, Math.max(0, (pos - tokenTime) / (next.time - tokenTime)))
    return { lineIndex: this.activeIndex ?? 0, tokenIndex, progress }
  }
}
