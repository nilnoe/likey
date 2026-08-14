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
/** 液体模式表面高光：顶面亮、倒影面更淡。 */
const SURFACE_RIM_TOP = 'rgba(255, 255, 255, 0.4)'
const SURFACE_RIM_BOTTOM = 'rgba(255, 255, 255, 0.22)'
const SURFACE_LINE_WIDTH = 1.5
/** 深绿电平表模式：纯净深绿纯色填充。 */
const GREEN_BAR = '#166534'
/**
 * 律动整体幅度系数：柱高/液面统一缩放到 90%，
 * 即使节拍脉冲顶到 1.05 也不会超出面板边缘（比例与律动逻辑不变）。
 */
const AMPLITUDE_SCALE = 0.9

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
    if (this.style.mode === 'liquid') {
      this.drawLiquid(width, height)
    } else if (this.style.mode === 'chunky') {
      this.drawChunky(width, height)
    } else if (this.style.mode === 'green') {
      this.drawGreen(width, height)
    } else if (this.style.mode === 'bands') {
      this.drawBands(width, height)
    } else if (this.style.mode === 'classic') {
      this.drawClassic(width, height)
    } else {
      this.drawBars(width, height)
    }
  }

  /** 频谱柱模式：细柱 + 峰值线。 */
  private drawBars(width: number, height: number): void {
    const count = this.values.length
    const slot = width / (this.style.mirror ? count * 2 : count)
    const barWidth = Math.max(1, slot - this.style.gap)
    this.drawBarGrid(
      height,
      slot,
      barWidth,
      count,
      Math.min(barWidth / 2, 3),
      (i) => this.values[i] ?? 0,
      (i) => this.peaks[i] ?? 0,
    )
  }

  /**
   * 加宽柱模式：柱数减半（相邻两根取最大值合并）、柱宽 ≈ 槽宽，顶部全圆角成胶囊状。
   */
  private drawChunky(width: number, height: number): void {
    const count = Math.max(1, Math.ceil(this.values.length / 2))
    const slot = width / (this.style.mirror ? count * 2 : count)
    const barWidth = Math.max(1, slot - Math.max(1, slot * 0.12))
    this.drawBarGrid(
      height,
      slot,
      barWidth,
      count,
      barWidth / 2,
      (i) => Math.max(this.values[i * 2] ?? 0, this.values[i * 2 + 1] ?? 0),
      (i) => Math.max(this.peaks[i * 2] ?? 0, this.peaks[i * 2 + 1] ?? 0),
    )
  }

  /**
   * 深绿电平表模式：单排加宽纯矩形柱，纯净深绿纯色填充。
   * 强制无镜像（忽略 mirror）、无倒影渐变、无圆角（忽略 rounded），
   * 只保留峰值线与节拍脉冲。
   */
  private drawGreen(width: number, height: number): void {
    const ctx = this.ctx
    if (ctx === null) return
    const count = Math.max(1, Math.ceil(this.values.length / 2))
    const slot = width / count
    const barWidth = Math.max(1, slot - Math.max(1, slot * 0.12))
    const pulseScale = 1 + 0.05 * this.pulse
    ctx.fillStyle = GREEN_BAR
    for (let i = 0; i < count; i++) {
      const value = Math.max(this.values[i * 2] ?? 0, this.values[i * 2 + 1] ?? 0)
      const barHeight = this.barHeightOf(value, height, pulseScale)
      ctx.fillRect(slot * i, height - barHeight, barWidth, barHeight)
    }
    if (this.style.peakHold) {
      for (let i = 0; i < count; i++) {
        const peak = Math.max(this.peaks[i * 2] ?? 0, this.peaks[i * 2 + 1] ?? 0)
        const peakY = peak * height * AMPLITUDE_SCALE * pulseScale
        ctx.fillStyle = PEAK_COLOR
        ctx.fillRect(slot * i, height - peakY - PEAK_LINE_HEIGHT, barWidth, PEAK_LINE_HEIGHT)
      }
    }
  }

  /**
   * 横向频谱带模式（千千静听原版）：每个频段一条横向长条上下堆叠，
   * 低频在最底部、高频在顶部，自左向右伸缩。单排、无镜像/倒影/峰值线。
   */
  private drawBands(width: number, height: number): void {
    const ctx = this.ctx
    if (ctx === null) return
    const count = this.values.length
    const stripHeight = height / count
    const gap = Math.min(1.5, Math.max(0.5, stripHeight * 0.18))
    const h = Math.max(1, stripHeight - gap)
    const pulseScale = 1 + 0.05 * this.pulse
    const primary = this.ensureGradient(height)
    ctx.fillStyle = primary
    for (let i = 0; i < count; i++) {
      const value = this.values[i] ?? 0
      const w = Math.max(0.5, value * width * pulseScale)
      const y = height - (i + 1) * stripHeight + gap / 2
      ctx.fillRect(0, y, w, h)
    }
  }

  /**
   * 经典原版模式（正弦构图）：只填 Q2（左上）与 Q4（右下）两象限，Q1/Q3 留空——
   * 低频在左右外缘、高频在中线相会，整体呈正弦函数形状。强制忽略 mirror。
   */
  private drawClassic(width: number, height: number): void {
    const ctx = this.ctx
    if (ctx === null) return
    const count = this.values.length
    const slot = width / (count * 2)
    const barWidth = Math.max(1, slot - this.style.gap)
    const pulseScale = 1 + 0.05 * this.pulse
    const baseY = height / 2
    const halfHeight = height / 2
    const primary = this.ensureGradient(height)
    ctx.fillStyle = primary
    for (let i = 0; i < count; i++) {
      const barHeight = this.barHeightOf(this.values[i] ?? 0, halfHeight, pulseScale)
      // Q2（左上）：低频在最左缘，向上
      this.drawBar(slot * i, baseY - barHeight, barWidth, barHeight, Math.min(barWidth / 2, 3))
      // Q4（右下）：低频在最右缘，向下
      this.drawBar(
        slot * (count * 2 - i - 1),
        baseY,
        barWidth,
        barHeight,
        Math.min(barWidth / 2, 3),
      )
    }
    if (this.style.peakHold) {
      for (let i = 0; i < count; i++) {
        const peakY = (this.peaks[i] ?? 0) * halfHeight * AMPLITUDE_SCALE * pulseScale
        ctx.fillStyle = PEAK_COLOR
        ctx.fillRect(slot * i, baseY - peakY, barWidth, PEAK_LINE_HEIGHT) // Q2
        ctx.fillRect(
          slot * (count * 2 - i - 1),
          baseY + peakY - PEAK_LINE_HEIGHT,
          barWidth,
          PEAK_LINE_HEIGHT,
        ) // Q4
      }
    }
  }

  /** 柱网格通用绘制：四象限低频居中 + 完全倒影 + 峰值线。 */
  private drawBarGrid(
    height: number,
    slot: number,
    barWidth: number,
    count: number,
    radius: number,
    valueAt: (i: number) => number,
    peakAt: (i: number) => number,
  ): void {
    const ctx = this.ctx
    if (ctx === null) return
    const mirror = this.style.mirror
    const pulseScale = 1 + 0.05 * this.pulse
    const baseY = height / 2
    const halfHeight = mirror ? height / 2 : height
    const primary = this.ensureGradient(height)
    const faded = mirror ? this.ensureFadedGradient(height) : primary

    for (let i = 0; i < count; i++) {
      const barHeight = this.barHeightOf(valueAt(i), halfHeight, pulseScale)
      if (mirror) {
        // 四象限低频居中 + 完全倒影：上半（Q1/Q2）主渐变，
        // 下半（Q3/Q4）同色倒影，自中心线向下渐隐（无硬切割）
        ctx.fillStyle = primary
        this.drawBar(slot * (count - 1 - i), baseY - barHeight, barWidth, barHeight, radius) // Q2
        this.drawBar(slot * (count + i), baseY - barHeight, barWidth, barHeight, radius) // Q1
        ctx.fillStyle = faded
        this.drawBar(slot * (count + i), baseY, barWidth, barHeight, radius) // Q4
        this.drawBar(slot * (count - 1 - i), baseY, barWidth, barHeight, radius) // Q3
      } else {
        ctx.fillStyle = primary
        this.drawBar(slot * i, height - barHeight, barWidth, barHeight, radius)
      }
    }

    if (this.style.peakHold) {
      for (let i = 0; i < count; i++) {
        const peakY = peakAt(i) * halfHeight * AMPLITUDE_SCALE * pulseScale
        if (mirror) {
          ctx.fillStyle = PEAK_COLOR
          ctx.fillRect(slot * (count - 1 - i), baseY - peakY, barWidth, PEAK_LINE_HEIGHT) // Q2
          ctx.fillRect(slot * (count + i), baseY - peakY, barWidth, PEAK_LINE_HEIGHT) // Q1
          ctx.fillStyle = FADED_PEAK_COLOR
          ctx.fillRect(
            slot * (count + i),
            baseY + peakY - PEAK_LINE_HEIGHT,
            barWidth,
            PEAK_LINE_HEIGHT,
          ) // Q4
          ctx.fillRect(
            slot * (count - 1 - i),
            baseY + peakY - PEAK_LINE_HEIGHT,
            barWidth,
            PEAK_LINE_HEIGHT,
          ) // Q3
        } else {
          ctx.fillStyle = PEAK_COLOR
          ctx.fillRect(slot * i, height - peakY - PEAK_LINE_HEIGHT, barWidth, PEAK_LINE_HEIGHT)
        }
      }
    }
  }

  /** 液体模式：整条无缝弧面剪影（顶面 + 倒影面），表面一圈高光边。 */
  private drawLiquid(width: number, height: number): void {
    const mirror = this.style.mirror
    const count = this.values.length
    const slot = width / (mirror ? count * 2 : count)
    const pulseScale = 1 + 0.05 * this.pulse
    const halfHeight = mirror ? height / 2 : height
    const baseY = mirror ? height / 2 : height
    const primary = this.ensureGradient(height)
    const faded = mirror ? this.ensureFadedGradient(height) : primary
    this.drawLiquidHalf(
      width,
      slot,
      count,
      baseY,
      halfHeight,
      pulseScale,
      1,
      primary,
      SURFACE_RIM_TOP,
    )
    if (mirror) {
      this.drawLiquidHalf(
        width,
        slot,
        count,
        height / 2,
        halfHeight,
        pulseScale,
        -1,
        faded,
        SURFACE_RIM_BOTTOM,
      )
    }
  }

  /**
   * 绘制一侧液体剪影：左缘 → 弧链（镜像时左半 i=count-1→0、右半 i=0→count-1）→ 右缘 → 沿轴闭合填充，
   * 再单独描一遍弧链表面做高光。direction=1 柱顶朝上，-1 柱顶朝下（倒影）。
   */
  private drawLiquidHalf(
    width: number,
    slot: number,
    count: number,
    baseY: number,
    halfHeight: number,
    pulseScale: number,
    direction: 1 | -1,
    fillStyle: string | CanvasGradient,
    rimColor: string,
  ): void {
    const ctx = this.ctx
    if (ctx === null) return
    const r = slot / 2
    const apexOf = (i: number): number => {
      const h = this.barHeightOf(this.values[i] ?? 0, halfHeight, pulseScale)
      return baseY - direction * h
    }
    const arcAt = (x: number, i: number): void => {
      const apex = apexOf(i)
      if (direction === 1) {
        ctx.arc(x + r, apex + r, r, Math.PI, Math.PI * 2)
      } else {
        ctx.arc(x + r, apex - r, r, Math.PI, 0, true)
      }
    }
    const trace = (start: 'move' | 'line'): void => {
      const firstI = this.style.mirror ? count - 1 : 0
      const firstY = direction === 1 ? apexOf(firstI) + r : apexOf(firstI) - r
      if (start === 'move') ctx.moveTo(0, firstY)
      else ctx.lineTo(0, firstY)
      if (this.style.mirror) {
        for (let i = count - 1; i >= 0; i--) arcAt(slot * (count - 1 - i), i)
        for (let i = 0; i < count; i++) arcAt(slot * (count + i), i)
      } else {
        for (let i = 0; i < count; i++) arcAt(slot * i, i)
      }
    }

    ctx.beginPath()
    ctx.moveTo(0, baseY)
    trace('line')
    ctx.lineTo(width, baseY)
    ctx.closePath()
    ctx.fillStyle = fillStyle
    ctx.fill()

    ctx.beginPath()
    trace('move')
    ctx.strokeStyle = rimColor
    ctx.lineWidth = SURFACE_LINE_WIDTH
    ctx.stroke()
  }

  /** 单根柱/单段液面的高度（平滑后 × 脉冲 × 幅度系数，下限 0.5px）。 */
  private barHeightOf(value: number, halfHeight: number, pulseScale: number): number {
    return Math.max(0.5, value * halfHeight * AMPLITUDE_SCALE * pulseScale)
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

  private drawBar(x: number, y: number, w: number, h: number, radius: number): void {
    const ctx = this.ctx
    if (ctx === null) return
    if (this.style.rounded && typeof ctx.roundRect === 'function') {
      ctx.beginPath()
      ctx.roundRect(x, y, w, h, radius)
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
