import { describe, expect, it } from 'vitest'
import { BufferCache } from './BufferCache'

describe('BufferCache', () => {
  it('throws on invalid capacity', () => {
    expect(() => new BufferCache<number>(0)).toThrow()
  })

  it('stores and retrieves by key', () => {
    const cache = new BufferCache<number>(2)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.put('a', 1)).toBeNull()
    expect(cache.get('a')).toBe(1)
    expect(cache.size).toBe(1)
  })

  it('evicts least-recently-used when over capacity', () => {
    const cache = new BufferCache<number>(2)
    cache.put('a', 1)
    cache.put('b', 2)
    expect(cache.put('c', 3)).toBe('a') // a 最久未用
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })

  it('get refreshes recency order', () => {
    const cache = new BufferCache<number>(2)
    cache.put('a', 1)
    cache.put('b', 2)
    cache.get('a') // a 变为最近使用
    expect(cache.put('c', 3)).toBe('b')
    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBeUndefined()
  })

  it('put on existing key refreshes recency without eviction', () => {
    const cache = new BufferCache<number>(2)
    cache.put('a', 1)
    cache.put('b', 2)
    expect(cache.put('a', 10)).toBeNull()
    expect(cache.size).toBe(2)
    expect(cache.get('a')).toBe(10)
  })

  it('clear empties cache', () => {
    const cache = new BufferCache<number>(2)
    cache.put('a', 1)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })
})
