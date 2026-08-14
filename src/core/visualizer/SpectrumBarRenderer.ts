import type { SpectrumFrame } from '../analysis/SpectrumExtractor'
import {
  DEFAULT_SPECTRUM_STYLE,
  PEAK_DROP_PER_FRAME,
  computePulse,
  smoothBars,
  updatePeaks,
  type SpectrumStyle,
} from './SpectrumStyle'
import { complementaryHex } from './color'

const PEAK_LINE_HEIGHT = 2
const PEAK_COLOR = 'rgba(255, 255, 255, 0.75)'
const COMPLEMENT_PEAK_COLOR = 'rgba(255, 255, 255, 0.45)'

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
  private complementGradient: CanvasGradient | null = null

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
    this.complementGradient = null
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
    this.complementGradient = null
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
    this.draw()
  }

  private draw(): void {
    const ctx = this.ctx
    if (ctx === null) return
    const { width, height } = ctx.canvas
    ctx.clearRect(0, 0, width, height)

    const mirror = this.style.mirror
    const count = this.values.length
    const total = mirror ? count * 2 : count
    const slot = width / total
    const barWidth = Math.max(1, slot - this.style.gap)
    const pulseScale = 1 + 0.05 * this.pulse
    const baseY = height / 2
    const halfHeight = mirror ? height / 2 : height
    const primary = this.ensureGradient(height)
    const complementary = mirror ? this.ensureComplementGradient(height) : primary

    for (let i = 0; i < count; i++) {
      const value = this.values[i] ?? 0
      const barHeight = Math.max(0.5, value * halfHeight * pulseScale)
      if (mirror) {
        // 四象限补全：Q2/Q4 原渐变，Q1/Q3 互补色（原为空的高频象限补满）
        ctx.fillStyle = primary
        this.drawBar(slot * i, baseY - barHeight, barWidth, barHeight) // Q2（左上）
        this.drawBar(slot * (total - i - 1), baseY, barWidth, barHeight) // Q4（右下）
        ctx.fillStyle = complementary
        this.drawBar(slot * (total - i - 1), baseY - barHeight, barWidth, barHeight) // Q1（右上）
        this.drawBar(slot * i, baseY, barWidth, barHeight) // Q3（左下）
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
          ctx.fillRect(slot * i, baseY - peakHeight, barWidth, PEAK_LINE_HEIGHT) // Q2
          ctx.fillRect(
            slot * (total - i - 1),
            baseY + peakHeight - PEAK_LINE_HEIGHT,
            barWidth,
            PEAK_LINE_HEIGHT,
          ) // Q4
          ctx.fillStyle = COMPLEMENT_PEAK_COLOR
          ctx.fillRect(slot * (total - i - 1), baseY - peakHeight, barWidth, PEAK_LINE_HEIGHT) // Q1
          ctx.fillRect(slot * i, baseY + peakHeight - PEAK_LINE_HEIGHT, barWidth, PEAK_LINE_HEIGHT) // Q3
        } else {
          ctx.fillStyle = PEAK_COLOR
          ctx.fillRect(slot * i, height - peakHeight - PEAK_LINE_HEIGHT, barWidth, PEAK_LINE_HEIGHT)
        }
      }
    }
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

  /** 互补色渐变（Q1/Q3 象限用）：主渐变两端的互补色。 */
  private ensureComplementGradient(height: number): string | CanvasGradient {
    if (this.complementGradient === null && this.ctx !== null) {
      const [c1, c2] = this.style.gradient
      const comp1 = complementaryHex(c1 ?? '#22d3ee') ?? '#ff5c8a'
      const comp2 = complementaryHex(c2 ?? '#a855f7') ?? '#57aa08'
      const gradient = this.ctx.createLinearGradient(0, 0, 0, height)
      gradient.addColorStop(0, comp1)
      gradient.addColorStop(1, comp2)
      this.complementGradient = gradient
    }
    return this.complementGradient ?? this.style.gradient[0] ?? '#22d3ee'
  }
}
