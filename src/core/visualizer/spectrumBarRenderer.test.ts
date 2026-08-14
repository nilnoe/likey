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
  clearRect(): void
  fillRect(): void
  beginPath(): void
  roundRect(): void
  fill(): void
  rect(): void
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
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
    clearRect: (): void => {
      calls.push('clearRect')
    },
    fillRect: (): void => {
      calls.push('fillRect')
    },
    beginPath: (): void => {
      calls.push('beginPath')
    },
    roundRect: (): void => {
      calls.push('roundRect')
    },
    fill: (): void => {
      calls.push('fill')
    },
    rect: (): void => {
      calls.push('rect')
    },
    moveTo: (x: number, y: number): void => {
      calls.push(`moveTo(${x},${y})`)
    },
    lineTo: (x: number, y: number): void => {
      calls.push(`lineTo(${x},${y})`)
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
  options: {
    waveform?: Uint8Array
    low?: number
    mid?: number
    high?: number
  } = {},
): SpectrumFrame {
  const bars = new Float32Array(barValues)
  const raw = new Uint8Array(1024)
  return {
    bars,
    raw,
    waveform: options.waveform ?? new Uint8Array(64).fill(128),
    lowEnergy: options.low ?? 0,
    midEnergy: options.mid ?? 0,
    highEnergy: options.high ?? 0,
  }
}

describe('SpectrumBarRenderer', () => {
  it('mounts and renders mirrored rounded bars + peak lines', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 4, mirror: true, rounded: true, gap: 2 })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([0.5, 0.25, 0.75, 0]), 0)
    renderer.render(makeFrame([0.4, 0.2, 0.7, 0]), 8) // beat 帧
    expect(calls).toContain('clearRect')
    expect(calls).toContain('createLinearGradient')
    // 四象限镜像：4 柱 × 4 象限 × 2 帧 = 32 圆角柱；峰值线 4 柱 × 4 象限 × 2 帧 = 32 条
    expect(calls.filter((c) => c === 'roundRect')).toHaveLength(32)
    expect(calls.filter((c) => c === 'fillRect')).toHaveLength(32)
  })

  it('mirror fills Q1/Q3 with the same gradient at reduced alpha', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 2, mirror: true })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([0.5, 0.25]), 0)
    // 前两个 stop 是主渐变原色，后两个是同色 0.45 透明度的倒影渐变
    expect(calls.filter((c) => c.startsWith('addColorStop'))).toEqual([
      'addColorStop(0,#22d3ee)',
      'addColorStop(1,#a855f7)',
      'addColorStop(0,rgba(34, 211, 238, 0.45))',
      'addColorStop(1,rgba(168, 85, 247, 0.45))',
    ])
  })

  it('renders non-mirror rectangular bars without peaks when disabled', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({
      barCount: 2,
      mirror: false,
      rounded: false,
      peakHold: false,
    })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([1, 0.5]), 0)
    expect(calls).not.toContain('roundRect')
    expect(calls).toContain('fillRect')
    expect(calls.filter((c) => c === 'fillRect')).toHaveLength(2)
  })

  it('adapts to frame bar count changes', () => {
    const { ctx } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 2 })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    expect(() => renderer.render(makeFrame([0.1, 0.2, 0.3, 0.4]), 0)).not.toThrow()
  })

  it('draws ambient glow (radial gradient) before the bars', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 4, mirror: true, rounded: true })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([0.5, 0.25, 0.75, 0], { low: 1 }), 0)
    expect(calls).toContain('createRadialGradient')
    expect(calls.filter((c) => c.startsWith('radialStop'))).toHaveLength(2)
    // 光晕必须在柱体之前铺底
    expect(calls.indexOf('createRadialGradient')).toBeLessThan(calls.indexOf('roundRect'))
  })

  it('draws the time-domain waveform line on top of the bars', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({
      barCount: 2,
      mirror: false,
      rounded: false,
      peakHold: false,
    })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    const wave = new Uint8Array(64).fill(200) // 全正半轴采样
    renderer.render(makeFrame([0.5, 0.25], { waveform: wave }), 0)
    // 两次描边（宽辉光 + 细主线）
    expect(calls.filter((c) => c === 'stroke')).toHaveLength(2)
    // 首点：x=0，正采样 → y 在中心线(75)下方：75 + (72/128) × 52.5
    expect(calls.find((c) => c.startsWith('moveTo'))).toBe('moveTo(0,104.53125)')
    // 波形描边晚于柱体绘制（叠在最上层）
    expect(calls.lastIndexOf('stroke')).toBeGreaterThan(calls.indexOf('fillRect'))
  })

  it('honors glow/waveform off switches', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 2, glow: false, waveform: false })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.render(makeFrame([0.5, 0.25]), 0)
    expect(calls).not.toContain('createRadialGradient')
    expect(calls).not.toContain('stroke')
  })

  it('setStyle resizes internal buffers', () => {
    const { ctx, calls } = makeFakeCtx()
    const renderer = new SpectrumBarRenderer({ barCount: 2, mirror: false, rounded: false })
    renderer.mount(makeFakeCanvas(ctx) as unknown as HTMLCanvasElement)
    renderer.setStyle({ barCount: 6 })
    renderer.render(makeFrame([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]), 0)
    expect(calls.filter((c) => c === 'fillRect').length).toBeGreaterThanOrEqual(6)
  })
})
