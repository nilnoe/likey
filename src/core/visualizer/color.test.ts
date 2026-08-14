import { describe, expect, it } from 'vitest'
import { hexToRgb, hexWithAlpha, mixWithAlpha } from './color'

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

describe('mixWithAlpha', () => {
  it('blends linearly and applies alpha', () => {
    expect(mixWithAlpha('#000000', '#ffffff', 0.5, 0.3)).toBe('rgba(128, 128, 128, 0.3)')
    expect(mixWithAlpha('#22d3ee', '#a855f7', 0.5, 0.45)).toBe('rgba(101, 148, 243, 0.45)')
    expect(mixWithAlpha('#22d3ee', '#a855f7', 0, 1)).toBe('rgba(34, 211, 238, 1)')
    expect(mixWithAlpha('#22d3ee', '#a855f7', 1, 1)).toBe('rgba(168, 85, 247, 1)')
  })

  it('clamps t and alpha', () => {
    expect(mixWithAlpha('#000000', '#ffffff', -1, 0.5)).toBe('rgba(0, 0, 0, 0.5)')
    expect(mixWithAlpha('#000000', '#ffffff', 2, 1.5)).toBe('rgba(255, 255, 255, 1)')
  })

  it('returns null for invalid hex', () => {
    expect(mixWithAlpha('bad', '#ffffff', 0.5, 1)).toBeNull()
    expect(mixWithAlpha('#ffffff', 'bad', 0.5, 1)).toBeNull()
  })
})
