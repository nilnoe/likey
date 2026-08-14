import { describe, expect, it } from 'vitest'
import { complementaryHex, hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from './color'

describe('hexToRgb / rgbToHex', () => {
  it('round-trips known colors', () => {
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0])
    expect(hexToRgb('#22d3ee')).toEqual([0x22, 0xd3, 0xee])
    expect(hexToRgb('ff00ff')).toEqual([255, 0, 255])
    expect(hexToRgb('garbage')).toBeNull()
    expect(rgbToHex([255, 0, 0])).toBe('#ff0000')
  })
})

describe('rgbToHsl / hslToRgb', () => {
  it('round-trips', () => {
    for (const hex of ['#ff0000', '#22d3ee', '#a855f7', '#808080', '#0b0f14']) {
      const rgb = hexToRgb(hex)
      expect(rgb).not.toBeNull()
      const hsl = rgbToHsl(rgb!)
      const back = rgbToHex(hslToRgb(hsl))
      expect(back).toBe(hex)
    }
  })
})

describe('complementaryHex', () => {
  it('shifts hue by 180 degrees', () => {
    expect(complementaryHex('#ff0000')).toBe('#00ffff') // 红 → 青
    expect(complementaryHex('#0000ff')).toBe('#ffff00') // 蓝 → 黄
    expect(complementaryHex('#808080')).toBe('#808080') // 灰不变
    expect(complementaryHex('bad')).toBeNull()
  })

  it('is an involution (double complement returns original)', () => {
    const original = '#22d3ee'
    const comp = complementaryHex(original)
    expect(comp).not.toBeNull()
    expect(complementaryHex(comp!)).toBe(original)
  })
})
