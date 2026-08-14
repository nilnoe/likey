import { describe, expect, it, vi } from 'vitest'
import { parseSearchResult, parseUrlResult } from '../../core/onlinesource/protocol'
import exampleSourceCode from '../../../public/sources/example.js?raw'

interface ConfigTrack {
  readonly id: string
  readonly title: string
  readonly artist: string
  readonly album: string
  readonly duration: number
  readonly fileUrl: string
}

interface WindowShim {
  source?: Record<string, unknown>
  handler?: (event: { data: unknown }) => void
  addEventListener(type: string, handler: (event: { data: unknown }) => void): void
}

const CONFIG_TRACKS: ConfigTrack[] = [
  {
    id: 't1',
    title: '晴天',
    artist: '周杰伦',
    album: '叶惠美',
    duration: 269,
    fileUrl: 'asset:///a.mp3',
  },
  {
    id: 't2',
    title: '七里香',
    artist: '周杰伦',
    album: '七里香',
    duration: 300,
    fileUrl: 'asset:///b.mp3',
  },
  {
    id: 't3',
    title: '夜曲',
    artist: '夜行者',
    album: '单曲',
    duration: 220,
    fileUrl: 'asset:///c.mp3',
  },
]

function loadExampleSource(): { source: Record<string, unknown>; windowShim: WindowShim } {
  const windowShim: WindowShim = {
    addEventListener: vi.fn((_type: string, handler: (event: { data: unknown }) => void) => {
      windowShim.handler = handler
    }),
  }
  // 与沙箱 iframe 相同的执行方式：脚本经 Function 构造，window 注入
  const runner = new Function('window', exampleSourceCode) as (w: WindowShim) => void
  runner(windowShim)
  // 主线程注入 config（模拟 SourceRuntime.sendConfig）
  windowShim.handler?.({ data: { type: 'config', payload: CONFIG_TRACKS } })
  const source = windowShim.source
  if (source === undefined) throw new Error('示例音源未定义 window.source')
  return { source, windowShim }
}

describe('内置示例音源协议合规', () => {
  it('defines the lx-music compatible source interface', () => {
    const { source } = loadExampleSource()
    expect(typeof source['search']).toBe('function')
    expect(typeof source['getMusicUrl']).toBe('function')
    expect(typeof source['getLyric']).toBe('function')
  })

  it('search filters by keyword and produces protocol-valid songs', () => {
    const { source } = loadExampleSource()
    const search = source['search'] as (keyword: string, page: number, limit: number) => unknown
    const songs = parseSearchResult(search('周杰伦', 1, 30))
    expect(songs).toHaveLength(2)
    expect(songs.map((s) => s.songmid).sort()).toEqual(['t1', 't2'])
    expect(songs[0]?.interval).toBeGreaterThan(0)
    expect(songs[0]?.source).toBe('likey-local')
  })

  it('empty keyword returns all and pagination works', () => {
    const { source } = loadExampleSource()
    const search = source['search'] as (keyword: string, page: number, limit: number) => unknown
    expect(parseSearchResult(search('', 1, 30))).toHaveLength(3)
    const page2 = parseSearchResult(search('', 2, 1))
    expect(page2).toHaveLength(1)
    expect(page2[0]?.songmid).toBe('t2')
  })

  it('getMusicUrl resolves known ids and nulls unknown ones', () => {
    const { source } = loadExampleSource()
    const getMusicUrl = source['getMusicUrl'] as (songmid: string) => unknown
    expect(parseUrlResult(getMusicUrl('t1'))).toBe('asset:///a.mp3')
    expect(parseUrlResult(getMusicUrl('missing'))).toBeNull()
  })

  it('getLyric returns null (无内嵌歌词)', () => {
    const { source } = loadExampleSource()
    const getLyric = source['getLyric'] as (songmid: string) => unknown
    expect(getLyric('t1')).toBeNull()
  })
})
