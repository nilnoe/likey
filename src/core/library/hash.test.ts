import { describe, expect, it } from 'vitest'
import { fnv1a } from './hash'

describe('fnv1a', () => {
  it('matches known FNV-1a 32-bit vectors', () => {
    expect(fnv1a('')).toBe('811c9dc5')
    expect(fnv1a('a')).toBe('e40c292c')
    expect(fnv1a('foobar')).toBe('bf9cf968')
  })

  it('is stable and case-sensitive', () => {
    const path = '/Users/mike/Music/song.mp3'
    expect(fnv1a(path)).toBe(fnv1a(path))
    expect(fnv1a(path)).not.toBe(fnv1a('/Users/mike/Music/Song.mp3'))
  })

  it('always emits 8 hex chars', () => {
    for (const input of ['x', 'music', '很长的一段中文路径/歌曲.flac']) {
      expect(fnv1a(input)).toMatch(/^[0-9a-f]{8}$/)
    }
  })
})
