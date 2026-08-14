import { describe, expect, it } from 'vitest'
import { computeGlow } from './ambient'

const NEUTRAL = { warmth: 0.5, intensity: 0.5 }

describe('computeGlow', () => {
  it('drifts toward warm color when low frequencies dominate', () => {
    // 冷暖均衡输入（low=high）目标色温恰为 0.5 → 作为中性基线
    const balanced = computeGlow(NEUTRAL, 1, 0, 1, 0)
    const warm = computeGlow(NEUTRAL, 1, 0, 0, 0)
    expect(warm.state.warmth).toBeGreaterThan(0.5)
    expect(warm.rgb[0]).toBeGreaterThan(balanced.rgb[0]) // 红分量相对上升
    expect(warm.rgb[2]).toBeLessThan(balanced.rgb[2]) // 蓝分量相对下降
  })

  it('drifts toward cool color when high frequencies dominate', () => {
    const result = computeGlow(NEUTRAL, 0, 0, 1, 0)
    expect(result.state.warmth).toBeLessThan(0.5)
    expect(result.rgb[2]).toBeGreaterThan(result.rgb[0]) // 蓝 > 红 = 偏冷
  })

  it('mid frequencies count half toward warm', () => {
    // 目标 0.5：从冷端出发应朝中性移动但不越过
    const fromCold = computeGlow({ warmth: 0, intensity: 0.5 }, 0, 1, 0, 0)
    expect(fromCold.state.warmth).toBeGreaterThan(0)
    expect(fromCold.state.warmth).toBeLessThan(0.5)
  })

  it('decays intensity on silence and keeps warmth', () => {
    const result = computeGlow(NEUTRAL, 0, 0, 0, 0)
    expect(result.state.intensity).toBeLessThan(0.5)
    expect(result.state.warmth).toBeCloseTo(0.5)
  })

  it('beat pulse raises alpha', () => {
    const flat = computeGlow(NEUTRAL, 1, 1, 1, 0)
    const pulsed = computeGlow(NEUTRAL, 1, 1, 1, 1)
    expect(pulsed.alpha).toBeGreaterThan(flat.alpha)
  })

  it('converges toward full warm/strong on sustained bass', () => {
    let state = { warmth: 0, intensity: 0 }
    for (let i = 0; i < 200; i++) {
      state = computeGlow(state, 1, 0, 0, 0).state
    }
    expect(state.warmth).toBeGreaterThan(0.99)
    expect(state.intensity).toBeGreaterThan(0.99)
  })
})
