import { describe, expect, it } from 'vitest'
import { hexToRgb, hexWithAlpha } from './color'

describe('hexToRgb', () => {
  it('parses 6-digit hex with or without #', () => {
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0])
    expect(hexToRgb('#22d3ee')).toEqual([0x22, 0xd3, 0xee])
    expect(hexToRgb('ff00ff')).toEqual([255, 0, 255])
  })

  it('returns null for invalid input', () => {
    expect(hexToRgb('garbage')).toBeNull()
    expect(hexToRgb('#123')).toBeNull()
  })
})

describe('hexWithAlpha', () => {
  it('produces rgba() with the given alpha', () => {
    expect(hexWithAlpha('#22d3ee', 0.45)).toBe('rgba(34, 211, 238, 0.45)')
    expect(hexWithAlpha('#a855f7', 0.45)).toBe('rgba(168, 85, 247, 0.45)')
  })

  it('clamps alpha to [0, 1]', () => {
    expect(hexWithAlpha('#ffffff', -0.5)).toBe('rgba(255, 255, 255, 0)')
    expect(hexWithAlpha('#ffffff', 1.5)).toBe('rgba(255, 255, 255, 1)')
  })

  it('returns null for invalid hex', () => {
    expect(hexWithAlpha('bad', 0.5)).toBeNull()
  })
})
