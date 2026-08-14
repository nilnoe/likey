import { describe, expect, it } from 'vitest'
import type { SpectrumFrame } from '../analysis/SpectrumExtractor'
import { SpectrumBarRenderer } from './SpectrumBarRenderer'
import { PEAK_DROP_PER_FRAME, computePulse, smoothBars, updatePeaks } from './SpectrumStyle'

describe('smoothBars', () => {
  it('rises instantly and decays exponentially', () => {
    const values = new Float32Array([0.5, 1])
    smoothBars(values, new Float32Array([1, 0]), 0.9)
    expect(values[0]).toBe(1) // 上升即时
    expect(values[1]).toBeCloseTo(0.9) // 下降衰减
  })
})

describe('updatePeaks', () => {
  it('follows max and drops per frame', () => {
    const peaks = new Float32Array([0.8])
    updatePeaks(peaks, new Float32Array([0.6]), PEAK_DROP_PER_FRAME)
    expect(peaks[0]).toBeCloseTo(0.8 - PEAK_DROP_PER_FRAME)
    updatePeaks(peaks, new Float32Array([0.9]), PEAK_DROP_PER_FRAME)
    expect(peaks[0]).toBeCloseTo(0.9)
  })
})

describe('computePulse', () => {
  it('decays without beat', () => {
    expect(computePulse(1, 0)).toBeCloseTo(0.92)
    expect(computePulse(0, 0)).toBe(0)
  })

  it('jumps on beat and caps at 1', () => {
    expect(computePulse(0.2, 8)).toBeCloseTo(1)
    expect(computePulse(0.1, 4)).toBeCloseTo(0.6)
  })
})

interface FakeGradient {
  addColorStop(offset: number, color: string): void
}

interface FakeCtx {
  canvas: { width: number; height: number }
  fillStyle: string
  clearRect(): void
  fillRect(x: number, y: number, w: number, h: number): void
  beginPath(): void
  roundRect(x: number, y: number, w: number, h: number, r: number): void
  fill(): void
  rect(): void
  arc(x: number, y: number, r: number): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
  stroke(): void
  createLinearGradient(): FakeGradient
  createRadialGradient(): FakeGradient
}

function makeFakeCtx(): { ctx: FakeCtx; calls: string[] } {
  const calls: string[] = []
  const linearGradient: FakeGradient = {
    addColorStop: (offset: number, color: string): void => {
      calls.push(`addColorStop(${offset},${color})`)
    },
  }
  const radialGradient: FakeGradient = {
    addColorStop: (offset: number, color: string): void => {
      calls.push(`radialStop(${offset},${color})`)
    },
  }
  const ctx: FakeCtx = {
    canvas: { width: 300, height: 150 },
    fillStyle: '',
    clearRect: (): void => {
      calls.push('clearRect')
    },
    fillRect: (x: number, y: number, w: number, h: number): void => {
      calls.push(`fillRect(${x.toFixed(2)},${y.toFixed(2)},${w.toFixed(2)},${h.toFixed(2)})`)
    },
    beginPath: (): void => {
      calls.push('beginPath')
    },
    roundRect: (x: number, y: number, _w: number, _h: number, r: number): void => {
      calls.push(`roundRect(${x.toFixed(1)},${y.toFixed(1)},${r.toFixed(1)})`)
    },
    fill: (): void => {
      calls.push('fill')
    },
    rect: (): void => {
      calls.push('rect')
    },
    arc: (x: number, y: number, r: number): void => {
      calls.push(`arc(${x.toFixed(1)},${y.toFixed(1)},${r.toFixed(1)})`)
    },
    moveTo: (x: number, y: number): void => {
      calls.push(`moveTo(${x.toFixed(1)},${y.toFixed(1)})`)
    },
    lineTo: (x: number, y: number): void => {
      calls.push(`lineTo(${x.toFixed(1)},${y.toFixed(1)})`)
    },
    closePath: (): void => {
      calls.push('closePath')
    },
    stroke: (): void => {
      calls.push('stroke')
    },
    createLinearGradient: (): FakeGradient => {
      calls.push('createLinearGradient')
      return linearGradient
    },
    createRadialGradient: (): FakeGradient => {
      calls.push('createRadialGradient')
      return radialGradient
    },
  }
  // 记录 fillStyle 赋值（字符串记颜色，渐变对象记 gradient），供纯色模式断言
  Object.defineProperty(ctx, 'fillStyle', {
    configurable: true,
    set: (value: unknown): void => {
      calls.push(typeof value === 'string' ? `fillStyle(${value})` : 'fillStyle(gradient)')
    },
  })
  return { ctx, calls }
}

function makeFakeCanvas(ctx: FakeCtx) {
  return {
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: 300, height: 150 }),
    width: 0,
    height: 0,
  }
}

function makeFrame(
  barValues: number[],
  options: { low?: number; mid?: number; high?: number } = {},
): SpectrumFrame {
  const bars = new Float32Array(barValues)
  const raw = new Uint8Array(1024)
  return {
    bars,
    raw,
    lowEnergy: options.low ?? 0,
    midEnergy: options.mid ?? 0,
    highEnergy: options.high ?? 0,
  }
}

/** 模拟 values 经由 frame.bars（Float32Array）的 float32 舍入。 */
function f32(v: number): number {
  return new Float32Array([v])[0] ?? v
}

describe('SpectrumBarRenderer', () => {
  it('mounts and renders mirrored rounded bars + peak lines', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({
      barCount: 4,
      mirror: true,
      rounded: true,
      gap: 2,
      mode: 'bars',
    })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([0.5, 0.25, 0.75, 0]), 0)
    renderer.render(makeFrame([0.4, 0.2, 0.7, 0]), 8) // beat 帧
    expect(calls).toContain('clearRect')
    expect(calls).toContain('createLinearGradient')
    // 四象限镜像：4 柱 × 4 象限 × 2 帧 = 32 圆角柱；峰值线 4 柱 × 4 象限 × 2 帧 = 32 条
    expect(calls.filter((c) => c.startsWith('roundRect'))).toHaveLength(32)
    expect(calls.filter((c) => c.startsWith('fillRect'))).toHaveLength(32)
  })

  it('mirrors bass toward the center (Q1/Q2 and Q3/Q4 swapped)', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({
      barCount: 4,
      mirror: true,
      rounded: true,
      gap: 0,
      mode: 'bars',
    })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    // 低频柱（i=0）最高：平移互换后应贴近中线（slot = 300/8 = 37.5），而不是面板外缘
    renderer.render(makeFrame([0.9, 0.1, 0.1, 0.1]), 0)
    const bars = calls.filter((c) => c.startsWith('roundRect'))
    // i=0 的四个象限：Q2/Q3 x=3×slot=112.5（中线左侧），Q1/Q4 x=4×slot=150（中线右侧）
    // AMPLITUDE_SCALE=0.9：h = max(0.5, v×75×0.9×1)，与实现同算式避免浮点误差
    const yTop = (v: number): string => (75 - Math.max(0.5, f32(v) * 75 * 0.9 * 1)).toFixed(1)
    expect(bars.slice(0, 4)).toEqual([
      `roundRect(112.5,${yTop(0.9)},3.0)`, // Q2 左上
      `roundRect(150.0,${yTop(0.9)},3.0)`, // Q1 右上
      'roundRect(150.0,75.0,3.0)', // Q4 右下
      'roundRect(112.5,75.0,3.0)', // Q3 左下
    ])
    // i=3 高频柱（最矮）落回外缘：Q2 x=0（面板最左）
    expect(bars[12]).toBe(`roundRect(0.0,${yTop(0.1)},3.0)`)
  })

  it('mirror uses a mirror-fading gradient for the bottom half', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 2, mirror: true, mode: 'bars' })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([0.5, 0.25]), 0)
    // 主渐变两 stop 原色；倒影渐变：中心线 50% 混合色 @45% → 底部回到底色 @6%
    expect(calls.filter((c) => c.startsWith('addColorStop'))).toEqual([
      'addColorStop(0,#22d3ee)',
      'addColorStop(1,#a855f7)',
      'addColorStop(0,rgba(101, 148, 243, 0.45))',
      'addColorStop(1,rgba(34, 211, 238, 0.06))',
    ])
  })

  it('renders non-mirror rectangular bars without peaks when disabled', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({
      barCount: 2,
      mirror: false,
      rounded: false,
      peakHold: false,
      mode: 'bars',
    })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([1, 0.5]), 0)
    expect(calls).not.toContain('roundRect')
    expect(calls.some((c) => c.startsWith('fillRect'))).toBe(true)
    expect(calls.filter((c) => c.startsWith('fillRect'))).toHaveLength(2)
  })

  it('adapts to frame bar count changes', () => {
    const { ctx } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 2, mode: 'bars' })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    expect(() => renderer.render(makeFrame([0.1, 0.2, 0.3, 0.4]), 0)).not.toThrow()
  })

  it('draws ambient glow (radial gradient) before the bars', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({
      barCount: 4,
      mirror: true,
      rounded: true,
      mode: 'bars',
    })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([0.5, 0.25, 0.75, 0], { low: 1 }), 0)
    expect(calls).toContain('createRadialGradient')
    expect(calls.filter((c) => c.startsWith('radialStop'))).toHaveLength(2)
    // 光晕必须在柱体之前铺底
    expect(calls.indexOf('createRadialGradient')).toBeLessThan(
      calls.findIndex((c) => c.startsWith('roundRect')),
    )
  })

  it('honors glow off switch', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 2, glow: false, mode: 'bars' })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([0.5, 0.25]), 0)
    expect(calls).not.toContain('createRadialGradient')
  })

  it('setStyle resizes internal buffers', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({
      barCount: 2,
      mirror: false,
      rounded: false,
      mode: 'bars',
    })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.setStyle({ barCount: 6 })
    renderer.render(makeFrame([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]), 0)
    expect(calls.filter((c) => c.startsWith('fillRect')).length).toBeGreaterThanOrEqual(6)
  })

  it('liquid mode draws seamless arc silhouettes with surface rims', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 2, mirror: true, mode: 'liquid' })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([0.5, 0.25]), 0)
    // 液体模式不用柱子/峰值线，改用连续弧面路径
    expect(calls).not.toContain('roundRect')
    expect(calls.some((c) => c.startsWith('fillRect'))).toBe(false)
    // 顶面 + 底面各一条剪影；每条弧链画两遍（填充 + 高光描边）→ 2×2×2×2 = 16 弧
    expect(calls.filter((c) => c === 'closePath')).toHaveLength(2)
    expect(calls.filter((c) => c.startsWith('arc'))).toHaveLength(16)
    expect(calls.filter((c) => c === 'stroke')).toHaveLength(2)
    expect(calls.filter((c) => c === 'fill')).toHaveLength(3)
  })

  it('liquid bass humps meet at the center with rounded arc tops', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 2, mirror: true, mode: 'liquid' })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([0.9, 0.1]), 0)
    // slot = 300/4 = 75, r = 37.5；弧链顺序：顶面填充(4) → 顶面高光(4) → 底面填充(4) → 底面高光(4)
    const arcs = calls.filter((c) => c.startsWith('arc'))
    // AMPLITUDE_SCALE=0.9：h = max(0.5, v×75×0.9×1)；顶面圆心 cy = 75 - h + 37.5，底面 cy = 75 + h - 37.5
    const hOf = (v: number): number => Math.max(0.5, f32(v) * 75 * 0.9 * 1)
    const cyTop = (v: number): string => (75 - hOf(v) + 37.5).toFixed(1)
    const cyBottom = (v: number): string => (75 + hOf(v) - 37.5).toFixed(1)
    expect(arcs[1]).toBe(`arc(112.5,${cyTop(0.9)},37.5)`) // 顶面左半低频：圆心贴近中心线
    expect(arcs[2]).toBe(`arc(187.5,${cyTop(0.9)},37.5)`) // 顶面右半低频：与左半在中心相会
    expect(arcs[3]).toBe(`arc(262.5,${cyTop(0.1)},37.5)`) // 高频弧落回右外缘（圆心更低=更矮）
    expect(arcs[9]).toBe(`arc(112.5,${cyBottom(0.9)},37.5)`) // 底面低频弧（朝下鼓）
  })

  it('liquid mode works in non-mirror layout', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 2, mirror: false, mode: 'liquid' })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([1, 0.5]), 0)
    // 单排剪影：2 弧 × 2 遍（填充 + 高光）、1 条闭合路径、1 条高光描边
    expect(calls.filter((c) => c.startsWith('arc'))).toHaveLength(4)
    expect(calls.filter((c) => c === 'closePath')).toHaveLength(1)
    expect(calls.filter((c) => c === 'stroke')).toHaveLength(1)
  })

  it('chunky mode halves bar count and draws fat capsules', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 4, mirror: true, mode: 'chunky' })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([0.5, 0.25, 0.75, 0]), 0)
    // 4 柱 → 2 根合并宽柱 × 4 象限 = 8 根；峰值线同样 8 条
    expect(calls.filter((c) => c.startsWith('roundRect'))).toHaveLength(8)
    expect(calls.filter((c) => c.startsWith('fillRect'))).toHaveLength(8)
    const bars = calls.filter((c) => c.startsWith('roundRect'))
    // slot = 300/4 = 75, barWidth = 75 - 9 = 66, radius = 33（胶囊全圆角）
    const yTop = (v: number): string => (75 - Math.max(0.5, f32(v) * 75 * 0.9 * 1)).toFixed(1)
    expect(bars[0]).toBe(`roundRect(75.0,${yTop(0.5)},33.0)`) // i=0 合并柱 (max(0.5,0.25)=0.5) 贴中线
    expect(bars[1]).toBe(`roundRect(150.0,${yTop(0.5)},33.0)`) // Q1
    expect(bars[4]).toBe(`roundRect(0.0,${yTop(0.75)},33.0)`) // i=1 合并柱 (max(0.75,0)=0.75) 回外缘
  })

  it('green mode draws single-row pure rectangles in solid dark green', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 4, mode: 'green' })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([0.5, 0.25, 0.75, 0]), 0)
    // 单排：2 根合并矩形柱 + 2 条峰值线 = 4 次 fillRect（无镜像/倒影的 4 象限放大）
    expect(calls.filter((c) => c.startsWith('fillRect'))).toHaveLength(4)
    // 纯矩形：无圆角、无液体弧面
    expect(calls).not.toContain('roundRect')
    expect(calls).not.toContain('closePath')
    expect(calls).not.toContain('stroke')
    // 纯净深绿纯色填充（非渐变）
    expect(calls).toContain('fillStyle(#166534)')
    expect(calls).not.toContain('fillStyle(#22d3ee)')
  })

  it('bands mode stacks horizontal strips with low frequency at the bottom', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 4, mode: 'bands' })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([0.5, 0.25, 0.75, 0]), 0)
    const rects = calls.filter((c) => c.startsWith('fillRect'))
    // 4 条横向带（无峰值线/无镜像放大），自左向右伸缩
    expect(rects).toHaveLength(4)
    // stripHeight = 150/4 = 37.5, gap = 1.5, h = 36；低频 i=0 在最底部
    // 宽度同样乘 AMPLITUDE_SCALE=0.9：满能量也不顶到右边缘
    expect(rects[0]).toBe('fillRect(0.00,113.25,135.00,36.00)') // 低频带：宽 0.5×300×0.9
    expect(rects[1]).toBe('fillRect(0.00,75.75,67.50,36.00)') // 中频带
    expect(rects[2]).toBe('fillRect(0.00,38.25,202.50,36.00)') // 高频带：宽 0.75×300×0.9
    expect(rects[3]).toBe('fillRect(0.00,0.75,0.50,36.00)') // 顶部静音带保底 0.5px
    expect(calls).not.toContain('roundRect')
    expect(calls).not.toContain('closePath')
  })

  it('classic mode fills only Q2/Q4 with the sine layout (Q1/Q3 empty)', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({
      barCount: 4,
      mode: 'classic',
      rounded: true,
      gap: 0,
    })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([0.9, 0.1, 0.1, 0.1]), 0)
    const bars = calls.filter((c) => c.startsWith('roundRect'))
    // 仅两象限：4 柱 × 2 象限 = 8 根（无 Q1/Q3 的四象限放大）
    expect(bars).toHaveLength(8)
    expect(calls.filter((c) => c.startsWith('fillRect'))).toHaveLength(8) // 峰值线 × 2 象限
    // slot = 300/8 = 37.5；正弦构图：低频在外缘、高频在中线
    const yTop = (v: number): string => (75 - Math.max(0.5, f32(v) * 75 * 0.9 * 1)).toFixed(1)
    expect(bars[0]).toBe(`roundRect(0.0,${yTop(0.9)},3.0)`) // Q2 低频柱在最左缘向上
    expect(bars[1]).toBe('roundRect(262.5,75.0,3.0)') // Q4 低频柱在最右缘向下
    expect(bars[7]).toBe('roundRect(150.0,75.0,3.0)') // Q4 高频柱在中线
  })
})
