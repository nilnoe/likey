/** 频谱柱渲染参数（皮肤协议的 spectrum 字段与此同构）。 */
export interface SpectrumStyle {
  readonly barCount: number
  readonly mirror: boolean
  readonly rounded: boolean
  readonly gap: number
  readonly gradient: readonly [string, string]
  readonly peakHold: boolean
  readonly fallSpeed: number
  readonly beatPulse: boolean
  /** 背景氛围光晕：色温随频段、透明度随能量 + 节拍呼吸 */
  readonly glow: boolean
  /** 视觉形态：bars = 频谱柱，liquid = 液体剪影，chunky = 加宽胶囊柱，green = 深绿电平表（单排纯色） */
  readonly mode: 'bars' | 'liquid' | 'chunky' | 'green'
}

export const DEFAULT_SPECTRUM_STYLE: SpectrumStyle = {
  barCount: 48,
  mirror: true,
  rounded: true,
  gap: 2,
  gradient: ['#22d3ee', '#a855f7'],
  peakHold: true,
  fallSpeed: 0.9,
  beatPulse: true,
  glow: true,
  mode: 'liquid',
}

/** 峰值线每帧下落量（0..1 刻度）。 */
export const PEAK_DROP_PER_FRAME = 0.006

/** 柱高平滑：上升即时、下降指数衰减（视觉「弹性」的关键）。原地修改 values。 */
export function smoothBars(values: Float32Array, next: Float32Array, fallSpeed: number): void {
  for (let i = 0; i < next.length; i++) {
    const incoming = next[i] ?? 0
    values[i] = Math.max(incoming, (values[i] ?? 0) * fallSpeed)
  }
}

/** 峰值保持线：跟随最大值，未超越时每帧缓慢下落。 */
export function updatePeaks(peaks: Float32Array, values: Float32Array, dropPerFrame: number): void {
  for (let i = 0; i < values.length; i++) {
    peaks[i] = Math.max(values[i] ?? 0, (peaks[i] ?? 0) - dropPerFrame)
  }
}

/** beat 脉冲能量：命中帧注入，其余帧指数衰减，输出 0..1。 */
export function computePulse(prev: number, beatStrength: number): number {
  if (beatStrength > 0) {
    return Math.min(1, prev + Math.min(1, beatStrength / 8))
  }
  return Math.max(0, prev * 0.92)
}
