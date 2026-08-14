import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  advanceAuto,
  advanceManual,
  createShuffleOrder,
  defaultReadSource,
  retreatManual,
} from './Queue'

describe('defaultReadSource', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads File via arrayBuffer', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a.mp3')
    const bytes = await defaultReadSource({ kind: 'file', file })
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('reads URL via fetch and throws on HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new ArrayBuffer(4), { status: 200 })),
    )
    const bytes = await defaultReadSource({ kind: 'url', url: 'asset:///x.mp3' })
    expect(bytes.byteLength).toBe(4)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    )
    await expect(defaultReadSource({ kind: 'url', url: 'asset:///x.mp3' })).rejects.toThrow(
      'HTTP 404',
    )
  })
})

describe('createShuffleOrder', () => {
  it('is a permutation of all indices', () => {
    const order = createShuffleOrder(10, 42)
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('is deterministic for the same seed and differs across seeds', () => {
    expect(createShuffleOrder(10, 7)).toEqual(createShuffleOrder(10, 7))
    expect(createShuffleOrder(10, 7)).not.toEqual(createShuffleOrder(10, 8))
  })

  it('handles empty and single-element orders', () => {
    expect(createShuffleOrder(0, 1)).toEqual([])
    expect(createShuffleOrder(1, 1)).toEqual([0])
  })
})

describe('advanceAuto（顺序模式）', () => {
  it('advances linearly', () => {
    expect(advanceAuto(5, 2, null, 'off')).toBe(3)
  })

  it('stops at end with repeat off', () => {
    expect(advanceAuto(5, 4, null, 'off')).toBeNull()
  })

  it('wraps with repeat all', () => {
    expect(advanceAuto(5, 4, null, 'all')).toBe(0)
  })

  it('returns null for empty queue or unknown index', () => {
    expect(advanceAuto(0, 0, null, 'off')).toBeNull()
    expect(advanceAuto(3, -1, null, 'all')).toBeNull()
    expect(advanceAuto(3, 5, null, 'all')).toBeNull()
  })
})

describe('advanceAuto（洗牌模式）', () => {
  const order = [2, 0, 3, 1, 4]

  it('follows the shuffle order', () => {
    expect(advanceAuto(5, 3, order, 'off')).toBe(1)
  })

  it('stops at shuffled end with repeat off, wraps with all', () => {
    expect(advanceAuto(5, 4, order, 'off')).toBeNull()
    expect(advanceAuto(5, 4, order, 'all')).toBe(2)
  })
})

describe('advanceManual / retreatManual', () => {
  it('wraps unconditionally regardless of repeat mode', () => {
    expect(advanceManual(3, 2, null)).toBe(0)
    expect(retreatManual(3, 0, null)).toBe(2)
    expect(retreatManual(3, 1, null)).toBe(0)
  })

  it('respects shuffle order and wraps', () => {
    const order = [2, 1, 0]
    expect(advanceManual(3, 0, order)).toBe(2) // 0 在 order 末尾 → 回绕到 order[0]
    expect(retreatManual(3, 2, order)).toBe(0) // 2 在 order 开头 → 回绕到 order[2]
  })

  it('returns null for empty queue', () => {
    expect(advanceManual(0, 0, null)).toBeNull()
    expect(retreatManual(0, 0, null)).toBeNull()
  })
})
