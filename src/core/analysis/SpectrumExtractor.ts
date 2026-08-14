/** 与 AnalyserNode 结构兼容的最小接口（单测可注入 fake）。 */
export interface AnalyserLike {
  readonly fftSize: number
  readonly frequencyBinCount: number
  getByteFrequencyData(array: Uint8Array): void
  getByteTimeDomainData(array: Uint8Array): void
}

export interface SpectrumFrame {
  /** 对数分桶后的柱能量，长度 = barCount，归一化 0..1 */
  readonly bars: Float32Array
  /** 原始频域数据（0..255），长度 = frequencyBinCount */
  readonly raw: Uint8Array
  /** 时域波形采样（0..255，中点 128），长度 = fftSize */
  readonly waveform: Uint8Array
  /** 低频能量 0..1（鼓/贝斯） */
  readonly lowEnergy: number
  /** 中频能量 0..1（人声/吉他） */
  readonly midEnergy: number
  /** 高频能量 0..1（镲片/气声） */
  readonly highEnergy: number
}

export interface SpectrumBands {
  readonly lowMax: number
  readonly midMax: number
  readonly highMax: number
}

export interface SpectrumExtractorOptions {
  readonly sampleRate: number
  readonly minFreq: number
  readonly maxFreq: number
  readonly barCount: number
  readonly bands?: Partial<SpectrumBands>
}

export const DEFAULT_BANDS: SpectrumBands = { lowMax: 250, midMax: 4000, highMax: 16000 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * 对数频率分桶：bar b 覆盖 [minFreq·r^(b/B), minFreq·r^((b+1)/B))，r = maxFreq/minFreq。
 * 返回每个 bar 对应的 [startBin, endBin) 区间。
 */
export function buildLogBuckets(
  minFreq: number,
  maxFreq: number,
  barCount: number,
  binHz: number,
  binCount: number,
): ReadonlyArray<readonly [number, number]> {
  const buckets: Array<[number, number]> = []
  const ratio = maxFreq / minFreq
  for (let b = 0; b < barCount; b++) {
    const f1 = minFreq * ratio ** (b / barCount)
    const f2 = minFreq * ratio ** ((b + 1) / barCount)
    const start = clamp(Math.floor(f1 / binHz), 0, binCount - 1)
    const end = clamp(Math.floor(f2 / binHz) + 1, start + 1, binCount)
    buckets.push([start, end])
  }
  return buckets
}

/** 计算 [f1, f2) 频率范围的归一化能量均值（0..1）。 */
export function bandEnergy(raw: Uint8Array, f1: number, f2: number, binHz: number): number {
  if (raw.length === 0) return 0
  const start = clamp(Math.floor(f1 / binHz), 0, raw.length - 1)
  const end = clamp(Math.floor(f2 / binHz) + 1, start + 1, raw.length)
  let sum = 0
  for (let i = start; i < end; i++) {
    sum += raw[i] ?? 0
  }
  return sum / (end - start) / 255
}

/**
 * 频谱帧提取器：每帧从 AnalyserNode 拉取频域数据，
 * 做对数分桶归一化 + 低/中/高频三段能量统计。
 */
export class SpectrumExtractor {
  private readonly analyser: AnalyserLike
  private readonly options: SpectrumExtractorOptions
  private readonly raw: Uint8Array
  private readonly timeDomain: Uint8Array
  private bars: Float32Array
  private buckets: ReadonlyArray<readonly [number, number]>
  private readonly binHz: number
  private readonly bands: SpectrumBands

  constructor(analyser: AnalyserLike, options: SpectrumExtractorOptions) {
    this.analyser = analyser
    this.options = options
    this.raw = new Uint8Array(analyser.frequencyBinCount)
    this.timeDomain = new Uint8Array(analyser.fftSize)
    this.bars = new Float32Array(options.barCount)
    this.binHz = options.sampleRate / analyser.fftSize
    this.bands = { ...DEFAULT_BANDS, ...options.bands }
    this.buckets = buildLogBuckets(
      options.minFreq,
      options.maxFreq,
      options.barCount,
      this.binHz,
      analyser.frequencyBinCount,
    )
  }

  get barCount(): number {
    return this.bars.length
  }

  /** 动态调整柱数（皮肤切换时同步）。 */
  setBarCount(barCount: number): void {
    if (barCount === this.bars.length || barCount < 1) return
    this.bars = new Float32Array(barCount)
    this.buckets = buildLogBuckets(
      this.options.minFreq,
      this.options.maxFreq,
      barCount,
      this.binHz,
      this.analyser.frequencyBinCount,
    )
  }

  nextFrame(): SpectrumFrame {
    this.analyser.getByteFrequencyData(this.raw)
    this.analyser.getByteTimeDomainData(this.timeDomain)
    for (let b = 0; b < this.buckets.length; b++) {
      const bucket = this.buckets[b]
      const start = bucket?.[0] ?? 0
      const end = bucket?.[1] ?? 0
      let sum = 0
      for (let i = start; i < end; i++) {
        sum += this.raw[i] ?? 0
      }
      this.bars[b] = sum / (end - start) / 255
    }
    const lowEnergy = bandEnergy(this.raw, this.options.minFreq, this.bands.lowMax, this.binHz)
    const midEnergy = bandEnergy(this.raw, this.bands.lowMax, this.bands.midMax, this.binHz)
    const highEnergy = bandEnergy(this.raw, this.bands.midMax, this.bands.highMax, this.binHz)
    return {
      bars: this.bars,
      raw: this.raw,
      waveform: this.timeDomain,
      lowEnergy,
      midEnergy,
      highEnergy,
    }
  }
}
