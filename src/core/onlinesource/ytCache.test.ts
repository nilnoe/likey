import { describe, expect, it } from 'vitest'
import { ExpiringCache } from './ytCache'

describe('ExpiringCache', () => {
  it('returns cached values within TTL and expires after', () => {
    let now = 1_000_000
    const cache = new ExpiringCache<string>(1000, () => now)
    expect(cache.get('a')).toBeUndefined()
    cache.set('a', 'hello')
    expect(cache.get('a')).toBe('hello')
    now += 999 // 未过期
    expect(cache.get('a')).toBe('hello')
    now += 2 // 过期
    expect(cache.get('a')).toBeUndefined()
    // 过期条目被清除
    expect(cache.get('a')).toBeUndefined()
  })

  it('isolates keys', () => {
    const cache = new ExpiringCache<number>(1000, () => 0)
    cache.set('a', 1)
    cache.set('b', 2)
    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBeUndefined()
  })

  it('overwrites on set and clears all', () => {
    const cache = new ExpiringCache<number>(1000, () => 0)
    cache.set('a', 1)
    cache.set('a', 2)
    expect(cache.get('a')).toBe(2)
    cache.clear()
    expect(cache.get('a')).toBeUndefined()
  })
})
