import type { SpectrumFrame } from '../analysis/SpectrumExtractor'
import {
  DEFAULT_SPECTRUM_STYLE,
  PEAK_DROP_PER_FRAME,
  computePulse,
  smoothBars,
  updatePeaks,
  type SpectrumStyle,
} from './SpectrumStyle'
import { computeGlow } from './ambient'
import { hexWithAlpha, mixWithAlpha, type Rgb } from './color'

const PEAK_LINE_HEIGHT = 2
const PEAK_COLOR = 'rgba(255, 255, 255, 0.75)'
/** 倒影（下半象限）：中心线处透明度，向下渐隐至 FADE_BOTTOM_ALPHA。 */
const FADE_ALPHA = 0.45
const FADE_BOTTOM_ALPHA = 0.06
const FADED_PEAK_COLOR = 'rgba(255, 255, 255, 0.35)'

/**
 * 千千静听风频谱柱渲染器（Canvas 2D）。
 * 每帧流程：平滑柱高 → 更新峰值线 → beat 脉冲 → 绘制。
 */
export class SpectrumBarRenderer {
  private canvas: HTMLCanvasElement | null = null
  private ctx: CanvasRenderingContext2D | null = null
  private style: SpectrumStyle
  private values: Float32Array
  private peaks: Float32Array
  private pulse = 0
  private gradient: CanvasGradient | null = null
  private fadedGradient: CanvasGradient | null = null
  private glowWarmth = 0
  private glowIntensity = 0
  private glowRgb: Rgb = [0, 0, 0]
  private glowAlpha = 0

  constructor(style: Partial<SpectrumStyle> = {}) {
    this.style = { ...DEFAULT_SPECTRUM_STYLE, ...style }
    this.values = new Float32Array(this.style.barCount)
    this.peaks = new Float32Array(this.style.barCount)
  }

  mount(canvas: HTMLCanvasElement): void {
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (ctx === null) {
      throw new Error('Canvas 2D context 不可用')
    }
    this.ctx = ctx
    this.resize()
  }

  setStyle(style: Partial<SpectrumStyle>): void {
    this.style = { ...this.style, ...style }
    if (this.values.length !== this.style.barCount) {
      this.values = new Float32Array(this.style.barCount)
      this.peaks = new Float32Array(this.style.barCount)
    }
    this.gradient = null
    this.fadedGradient = null
  }

  /** 依据 CSS 尺寸 × devicePixelRatio 重建画布物理尺寸。 */
  resize(): void {
    const canvas = this.canvas
    const ctx = this.ctx
    if (canvas === null || ctx === null) return
    const rect = canvas.getBoundingClientRect()
    const dpr =
      typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
    canvas.width = Math.max(1, Math.round(rect.width * dpr))
    canvas.height = Math.max(1, Math.round(rect.height * dpr))
    this.gradient = null
    this.fadedGradient = null
  }

  render(frame: SpectrumFrame, beatStrength: number): void {
    const ctx = this.ctx
    if (ctx === null) return
    if (frame.bars.length !== this.values.length) {
      this.values = new Float32Array(frame.bars.length)
      this.peaks = new Float32Array(frame.bars.length)
    }
    smoothBars(this.values, frame.bars, this.style.fallSpeed)
    if (this.style.peakHold) {
      updatePeaks(this.peaks, this.values, PEAK_DROP_PER_FRAME)
    }
    this.pulse = computePulse(this.pulse, this.style.beatPulse ? beatStrength : 0)
    const glow = computeGlow(
      { warmth: this.glowWarmth, intensity: this.glowIntensity },
      frame.lowEnergy,
      frame.midEnergy,
      frame.highEnergy,
      this.pulse,
    )
    this.glowWarmth = glow.state.warmth
    this.glowIntensity = glow.state.intensity
    this.glowRgb = glow.rgb
    this.glowAlpha = glow.alpha
    this.draw()
  }

  private draw(): void {
    const ctx = this.ctx
    if (ctx === null) return
    const { width, height } = ctx.canvas
    ctx.clearRect(0, 0, width, height)
    if (this.style.glow) {
      this.drawGlow(width, height)
    }

    const mirror = this.style.mirror
    const count = this.values.length
    const total = mirror ? count * 2 : count
    const slot = width / total
    const barWidth = Math.max(1, slot - this.style.gap)
    const pulseScale = 1 + 0.05 * this.pulse
    const baseY = height / 2
    const halfHeight = mirror ? height / 2 : height
    const primary = this.ensureGradient(height)
    const faded = mirror ? this.ensureFadedGradient(height) : primary

    for (let i = 0; i < count; i++) {
      const value = this.values[i] ?? 0
      const barHeight = Math.max(0.5, value * halfHeight * pulseScale)
      if (mirror) {
        // 四象限低频居中 + 完全倒影：上半（Q1/Q2）主渐变，
        // 下半（Q3/Q4）同色倒影，自中心线向下渐隐（无硬切割）
        ctx.fillStyle = primary
        this.drawBar(slot * (count - 1 - i), baseY - barHeight, barWidth, barHeight) // Q2（左上）
        this.drawBar(slot * (count + i), baseY - barHeight, barWidth, barHeight) // Q1（右上）
        ctx.fillStyle = faded
        this.drawBar(slot * (count + i), baseY, barWidth, barHeight) // Q4（右下）
        this.drawBar(slot * (count - 1 - i), baseY, barWidth, barHeight) // Q3（左下）
      } else {
        ctx.fillStyle = primary
        this.drawBar(slot * i, height - barHeight, barWidth, barHeight)
      }
    }

    if (this.style.peakHold) {
      for (let i = 0; i < count; i++) {
        const peakHeight = (this.peaks[i] ?? 0) * halfHeight * pulseScale
        if (mirror) {
          ctx.fillStyle = PEAK_COLOR
          ctx.fillRect(slot * (count - 1 - i), baseY - peakHeight, barWidth, PEAK_LINE_HEIGHT) // Q2
          ctx.fillRect(slot * (count + i), baseY - peakHeight, barWidth, PEAK_LINE_HEIGHT) // Q1
          ctx.fillStyle = FADED_PEAK_COLOR
          ctx.fillRect(
            slot * (count + i),
            baseY + peakHeight - PEAK_LINE_HEIGHT,
            barWidth,
            PEAK_LINE_HEIGHT,
          ) // Q4
          ctx.fillRect(
            slot * (count - 1 - i),
            baseY + peakHeight - PEAK_LINE_HEIGHT,
            barWidth,
            PEAK_LINE_HEIGHT,
          ) // Q3
        } else {
          ctx.fillStyle = PEAK_COLOR
          ctx.fillRect(slot * i, height - peakHeight - PEAK_LINE_HEIGHT, barWidth, PEAK_LINE_HEIGHT)
        }
      }
    }
  }

  /** 背景氛围光晕：中心径向渐变，色温/透明度由 computeGlow 逐帧驱动。 */
  private drawGlow(width: number, height: number): void {
    const ctx = this.ctx
    if (ctx === null) return
    const r = this.glowRgb[0] ?? 0
    const g = this.glowRgb[1] ?? 0
    const b = this.glowRgb[2] ?? 0
    const radius = Math.max(width, height) * 0.55
    const glow = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, radius)
    glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${this.glowAlpha})`)
    glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.rect(0, 0, width, height)
    ctx.fill()
  }

  private drawBar(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx
    if (ctx === null) return
    if (this.style.rounded && typeof ctx.roundRect === 'function') {
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, Math.min(w / 2, 3))
      ctx.fill()
    } else {
      ctx.fillRect(x, y, w, h)
    }
  }

  private ensureGradient(height: number): string | CanvasGradient {
    if (this.gradient === null && this.ctx !== null) {
      const [c1, c2] = this.style.gradient
      const gradient = this.ctx.createLinearGradient(0, 0, 0, height)
      gradient.addColorStop(0, c1 ?? '#22d3ee')
      gradient.addColorStop(1, c2 ?? '#a855f7')
      this.gradient = gradient
    }
    return this.gradient ?? this.style.gradient[0] ?? '#22d3ee'
  }

  /** 倒影渐变（下半象限用）：中心线为两色 50% 混合 @45%，向底部渐隐至 6% 并镜像回底色。 */
  private ensureFadedGradient(height: number): string | CanvasGradient {
    if (this.fadedGradient === null && this.ctx !== null) {
      const [c1, c2] = this.style.gradient
      const bottom = c1 ?? '#22d3ee'
      const top = c2 ?? '#a855f7'
      // 中心线处主渐变正显示 50% 混合色 → 倒影从这里起步，颜色向下镜像回 c1（水面倒映）
      const mid =
        mixWithAlpha(bottom, top, 0.5, FADE_ALPHA) ?? hexWithAlpha(bottom, FADE_ALPHA) ?? bottom
      const edge = hexWithAlpha(bottom, FADE_BOTTOM_ALPHA) ?? bottom
      const gradient = this.ctx.createLinearGradient(0, height / 2, 0, height)
      gradient.addColorStop(0, mid)
      gradient.addColorStop(1, edge)
      this.fadedGradient = gradient
    }
    return this.fadedGradient ?? this.style.gradient[0] ?? '#22d3ee'
  }
}
