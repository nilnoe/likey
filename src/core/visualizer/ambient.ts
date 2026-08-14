/**
 * 背景氛围光晕：色温跟随频谱主能量（低频暖 / 高频冷），
 * 透明度跟随整体能量并叠加节拍呼吸。纯函数可单测。
 */
import type { Rgb } from './color'

export interface GlowState {
  /** 色温平滑值：0 = 高频主导（冷），1 = 低频主导（暖） */
  readonly warmth: number
  /** 能量平滑值 0..1 */
  readonly intensity: number
}

export interface GlowResult {
  readonly state: GlowState
  /** 光晕核心色 RGB（0..255） */
  readonly rgb: Rgb
  /** 光晕核心透明度 0..1（已含节拍呼吸） */
  readonly alpha: number
}

/** 低频主导时的暖色（暖橙）。 */
const WARM_RGB: Rgb = [255, 157, 92]
/** 高频主导时的冷色（与主渐变起点同族的青）。 */
const COOL_RGB: Rgb = [34, 211, 238]

/** 色温/能量平滑系数：越小越「迟钝」。 */
const GLOW_SMOOTH = 0.08
/** 静音时能量衰减系数。 */
const SILENCE_DECAY = 0.9
/** 光晕透明度 = BASE + GAIN × intensity。 */
const GLOW_BASE_ALPHA = 0.04
const GLOW_GAIN = 0.2
/** 节拍呼吸幅度：beat 时透明度最多 +30%。 */
const GLOW_BREATH = 0.3

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * 依据上一帧状态与当前帧三段能量计算光晕。
 * warmth：低频占 1、中频占 0.5、高频占 0 的加权占比，再指数平滑。
 */
export function computeGlow(
  prev: GlowState,
  low: number,
  mid: number,
  high: number,
  pulse: number,
): GlowResult {
  const total = low + mid + high
  let warmth = prev.warmth
  let intensity = prev.intensity
  if (total > 1e-4) {
    const targetWarmth = (low + mid * 0.5) / total
    warmth += (targetWarmth - warmth) * GLOW_SMOOTH
    intensity += (Math.min(1, total) - intensity) * GLOW_SMOOTH
  } else {
    intensity *= SILENCE_DECAY // 静音缓慢熄灭，色温保持不变
  }
  const w = clamp01(warmth)
  const rgb: Rgb = [
    Math.round((WARM_RGB[0] ?? 0) * w + (COOL_RGB[0] ?? 0) * (1 - w)),
    Math.round((WARM_RGB[1] ?? 0) * w + (COOL_RGB[1] ?? 0) * (1 - w)),
    Math.round((WARM_RGB[2] ?? 0) * w + (COOL_RGB[2] ?? 0) * (1 - w)),
  ]
  const alpha = (GLOW_BASE_ALPHA + GLOW_GAIN * intensity) * (1 + GLOW_BREATH * pulse)
  return { state: { warmth: w, intensity }, rgb, alpha }
}
