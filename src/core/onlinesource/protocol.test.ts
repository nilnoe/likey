import { describe, expect, it } from 'vitest'
import {
  isSourceRuntimeMessage,
  parseLyricResult,
  parseSearchResult,
  parseUrlResult,
  type SourceSong,
} from './protocol'

describe('parseSearchResult', () => {
  it('accepts valid songs and fills defaults', () => {
    const songs = parseSearchResult([
      {
        songmid: '1',
        name: '歌',
        singer: '人',
        album: '专辑',
        interval: 240,
        img: 'x',
        source: 'src',
      },
      { songmid: '2', name: '另一首' },
    ])
    expect(songs).toHaveLength(2)
    expect(songs[0]).toEqual({
      songmid: '1',
      name: '歌',
      singer: '人',
      album: '专辑',
      interval: 240,
      img: 'x',
      source: 'src',
    })
    expect(songs[1]?.singer).toBe('')
    expect(songs[1]?.interval).toBe(0)
    expect(songs[1]?.source).toBe('unknown')
  })

  it('drops invalid entries', () => {
    expect(parseSearchResult('not-array')).toEqual([])
    expect(parseSearchResult(null)).toEqual([])
    expect(
      parseSearchResult([
        { songmid: '', name: 'x' },
        { songmid: '1' },
        'garbage',
        42,
        null,
        { songmid: 'ok', name: '有效' },
      ]),
    ).toHaveLength(1)
  })

  it('accepts empty array', () => {
    expect(parseSearchResult([])).toEqual([])
  })
})

describe('parseUrlResult / parseLyricResult', () => {
  it('accepts non-empty strings only', () => {
    expect(parseUrlResult('https://example.com/a.mp3')).toBe('https://example.com/a.mp3')
    expect(parseUrlResult('')).toBeNull()
    expect(parseUrlResult(null)).toBeNull()
    expect(parseUrlResult(42)).toBeNull()
    expect(parseLyricResult('[00:01.00]歌词')).toBe('[00:01.00]歌词')
    expect(parseLyricResult(null)).toBeNull()
  })
})

describe('isSourceRuntimeMessage', () => {
  it('discriminates protocol messages', () => {
    expect(isSourceRuntimeMessage({ type: 'call', callId: 'c1', method: 'search', args: [] })).toBe(
      true,
    )
    expect(isSourceRuntimeMessage({ type: 'ready', ok: true })).toBe(true)
    expect(isSourceRuntimeMessage({ type: 'fetch', fetchId: 'f1', url: 'x' })).toBe(true)
    expect(isSourceRuntimeMessage({ type: 'unknown' })).toBe(false)
    expect(isSourceRuntimeMessage('not-object')).toBe(false)
    expect(isSourceRuntimeMessage(null)).toBe(false)
  })
})

describe('SourceSong 契约（编译期类型 + 运行时兜底）', () => {
  it('parsed songs always carry required fields', () => {
    const songs: SourceSong[] = parseSearchResult([{ songmid: 'a', name: 'b' }])
    for (const song of songs) {
      expect(typeof song.songmid).toBe('string')
      expect(typeof song.name).toBe('string')
      expect(typeof song.singer).toBe('string')
      expect(typeof song.interval).toBe('number')
    }
  })
})
