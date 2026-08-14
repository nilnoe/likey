export interface BeatEvent {
  /** 节拍强度：当前能量/阈值，>1 必触发，值越大越「重」 */
  readonly strength: number
  /** 时间戳 ms（与音频时钟同域） */
  readonly time: number
}

export interface BeatDetectorOptions {
  readonly historyFrames: number
  readonly sensitivity: number
  readonly cooldownMs: number
}

export const DEFAULT_BEAT_OPTIONS: BeatDetectorOptions = {
  historyFrames: 60,
  sensitivity: 1.4,
  cooldownMs: 250,
}

export function meanOf(values: readonly number[]): number {
  if (values.length === 0) return 0
  let sum = 0
  for (const v of values) {
    sum += v
  }
  return sum / values.length
}

export function stddevOf(values: readonly number[], mean: number): number {
  if (values.length < 2) return 0
  let sum = 0
  for (const v of values) {
    const d = v - mean
    sum += d * d
  }
  return Math.sqrt(sum / values.length)
}

/**
 * 低频能量 onset 节拍检测（自适应阈值，无需 BPM 先验）。
 * 阈值 = mean + sensitivity·max(σ, ε)，命中后进入冷却期防连击；
 * 命中帧按阈值入历史，防阈值自膨胀。
 */
export class BeatDetector {
  private static readonly MIN_HISTORY = 8
  private static readonly EPSILON = 1e-4

  private history: number[] = []
  private lastBeatTime = Number.NEGATIVE_INFINITY
  private readonly options: BeatDetectorOptions

  constructor(options: Partial<BeatDetectorOptions> = {}) {
    this.options = { ...DEFAULT_BEAT_OPTIONS, ...options }
  }

  update(lowEnergy: number, time: number): BeatEvent | null {
    const { historyFrames, sensitivity, cooldownMs } = this.options
    const mean = meanOf(this.history)
    const stddev = stddevOf(this.history, mean)
    const threshold = mean + sensitivity * Math.max(stddev, BeatDetector.EPSILON)

    let event: BeatEvent | null = null
    const isOnset = this.history.length >= BeatDetector.MIN_HISTORY && lowEnergy > threshold
    if (isOnset) {
      // 超阈值帧一律按阈值入历史（防阈值自膨胀），事件触发另受冷却约束
      this.history.push(Math.min(lowEnergy, threshold))
      if (time - this.lastBeatTime >= cooldownMs) {
        event = { strength: lowEnergy / threshold, time }
        this.lastBeatTime = time
      }
    } else {
      this.history.push(lowEnergy)
    }
    if (this.history.length > historyFrames) {
      this.history.shift()
    }
    return event
  }

  reset(): void {
    this.history = []
    this.lastBeatTime = Number.NEGATIVE_INFINITY
  }
}
