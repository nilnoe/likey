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
import { hexWithAlpha, type Rgb } from './color'

const PEAK_LINE_HEIGHT = 2
const PEAK_COLOR = 'rgba(255, 255, 255, 0.75)'
/** Q1/Q3 倒影象限的透明度：同主渐变淡化为水面倒影。 */
const FADE_ALPHA = 0.45
const FADED_PEAK_COLOR = 'rgba(255, 255, 255, 0.35)'
/** 时域波形线：宽低透明「辉光」描边 + 细高透明主线。 */
const WAVEFORM_GLOW_COLOR = 'rgba(255, 255, 255, 0.12)'
const WAVEFORM_GLOW_WIDTH = 5
const WAVEFORM_CORE_COLOR = 'rgba(255, 255, 255, 0.45)'
const WAVEFORM_CORE_WIDTH = 1.5
/** 波形线单帧最多采样点数（时域 fftSize 2048 → 抽稀到 512）。 */
const WAVEFORM_MAX_POINTS = 512
/** 波形线振幅占半高的比例。 */
const WAVEFORM_AMPLITUDE = 0.7

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
  private waveform: Uint8Array = new Uint8Array(0)

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
    this.waveform = frame.waveform
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
        // 四象限补全：Q2/Q4 原渐变，Q1/Q3 同色淡化（水面倒影）
        ctx.fillStyle = primary
        this.drawBar(slot * i, baseY - barHeight, barWidth, barHeight) // Q2（左上）
        this.drawBar(slot * (total - i - 1), baseY, barWidth, barHeight) // Q4（右下）
        ctx.fillStyle = faded
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
          ctx.fillStyle = FADED_PEAK_COLOR
          ctx.fillRect(slot * (total - i - 1), baseY - peakHeight, barWidth, PEAK_LINE_HEIGHT) // Q1
          ctx.fillRect(slot * i, baseY + peakHeight - PEAK_LINE_HEIGHT, barWidth, PEAK_LINE_HEIGHT) // Q3
        } else {
          ctx.fillStyle = PEAK_COLOR
          ctx.fillRect(slot * i, height - peakHeight - PEAK_LINE_HEIGHT, barWidth, PEAK_LINE_HEIGHT)
        }
      }
    }

    if (this.style.waveform) {
      this.drawWaveform(width, height)
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

  /** 时域波形线：居中横贯的示波器细线，两次描边做出辉光感。 */
  private drawWaveform(width: number, height: number): void {
    const ctx = this.ctx
    if (ctx === null) return
    const samples = this.waveform
    if (samples.length < 2) return
    const stride = Math.max(1, Math.ceil(samples.length / WAVEFORM_MAX_POINTS))
    const count = Math.ceil(samples.length / stride)
    const amp = (height / 2) * WAVEFORM_AMPLITUDE
    const baseY = height / 2
    ctx.beginPath()
    let j = 0
    for (let i = 0; i < samples.length; i += stride, j++) {
      const v = ((samples[i] ?? 128) - 128) / 128
      const x = (j / (count - 1)) * width
      const y = baseY + v * amp
      if (j === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = WAVEFORM_GLOW_COLOR
    ctx.lineWidth = WAVEFORM_GLOW_WIDTH
    ctx.stroke()
    ctx.strokeStyle = WAVEFORM_CORE_COLOR
    ctx.lineWidth = WAVEFORM_CORE_WIDTH
    ctx.stroke()
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

  /** 淡化渐变（Q1/Q3 倒影象限用）：与主渐变同色，仅降低透明度。 */
  private ensureFadedGradient(height: number): string | CanvasGradient {
    if (this.fadedGradient === null && this.ctx !== null) {
      const [c1, c2] = this.style.gradient
      const faded1 = hexWithAlpha(c1 ?? '#22d3ee', FADE_ALPHA) ?? c1 ?? '#22d3ee'
      const faded2 = hexWithAlpha(c2 ?? '#a855f7', FADE_ALPHA) ?? c2 ?? '#a855f7'
      const gradient = this.ctx.createLinearGradient(0, 0, 0, height)
      gradient.addColorStop(0, faded1)
      gradient.addColorStop(1, faded2)
      this.fadedGradient = gradient
    }
    return this.fadedGradient ?? this.style.gradient[0] ?? '#22d3ee'
  }
}
