import { describe, expect, it, vi } from 'vitest'
import { parseSearchResult, parseUrlResult } from '../../core/onlinesource/protocol'
import audiusCode from '../../../public/sources/audius.js?raw'
import exampleCode from '../../../public/sources/example.js?raw'
import itunesCode from '../../../public/sources/itunes.js?raw'

/**
 * 内置音源脚本协议合规测试：
 * 以沙箱同款执行方式（Function + window 注入）真实评估脚本，
 * fetch 以桩替换（脚本逻辑测试不依赖网络；真实 API 可用性由 curl/探测脚本验证）。
 */

interface SourceWindow extends Record<string, unknown> {
  source?: Record<string, unknown>
  handler?: (event: { data: unknown }) => void
  addEventListener(type: string, handler: (event: { data: unknown }) => void): void
}

type StubFetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

interface FetchStub {
  /** url → { ok, status, json } */
  respond: (url: string, body: unknown, ok?: boolean) => void
  calls: string[]
}

interface LoadedSource {
  readonly source: Record<string, unknown>
  readonly fetchStub: FetchStub
  readonly windowShim: SourceWindow
}

function loadSource(code: string): LoadedSource {
  const responses = new Map<string, { ok: boolean; status: number; json: unknown }>()
  const fetchStub: FetchStub = {
    calls: [],
    respond: (url, body, ok = true) => {
      responses.set(url, { ok, status: ok ? 200 : 500, json: body })
    },
  }
  const windowShim: SourceWindow = {
    addEventListener: vi.fn((_type: string, handler: (event: { data: unknown }) => void) => {
      windowShim.handler = handler
    }),
  }
  const stubFetch: StubFetch = (url) => {
    fetchStub.calls.push(url)
    const entry = responses.get(url)
    if (entry === undefined) {
      return Promise.reject(new Error(`未注册的 fetch URL: ${url}`))
    }
    return Promise.resolve({
      ok: entry.ok,
      status: entry.status,
      json: async () => entry.json,
    })
  }
  const runner = new Function('window', 'fetch', code) as (w: SourceWindow, f: StubFetch) => void
  runner(windowShim, stubFetch)
  const source = windowShim.source
  if (source === undefined) throw new Error('脚本未定义 window.source')
  return { source, fetchStub, windowShim }
}

interface ConfigTrack {
  readonly id: string
  readonly title: string
  readonly artist: string
  readonly album: string
  readonly duration: number
  readonly fileUrl: string
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
]

describe('内置音源协议合规', () => {
  it('示例源（本地音乐库）：config 注入 + search/getMusicUrl 符合协议', async () => {
    const { source, windowShim } = loadSource(exampleCode)
    expect(typeof source['search']).toBe('function')
    expect(typeof source['getMusicUrl']).toBe('function')
    expect(typeof source['getLyric']).toBe('function')
    // 模拟主线程 SourceRuntime.sendConfig
    windowShim.handler?.({ data: { type: 'config', payload: CONFIG_TRACKS } })
    const search = source['search'] as (keyword: string, page: number, limit: number) => unknown
    const songs = parseSearchResult(search('周杰伦', 1, 30))
    expect(songs.map((s) => s.songmid).sort()).toEqual(['t1', 't2'])
    const getMusicUrl = source['getMusicUrl'] as (songmid: string) => unknown
    expect(parseUrlResult(getMusicUrl('t1'))).toBe('asset:///a.mp3')
    expect(parseUrlResult(getMusicUrl('missing'))).toBeNull()
  })

  it('Audius 源：搜索映射与流地址生成', async () => {
    const { source, fetchStub } = loadSource(audiusCode)
    fetchStub.respond(
      'https://api.audius.co/v1/tracks/search?query=daft&app_name=LIKEY&offset=0&limit=30',
      {
        data: [
          {
            id: 'vZJJz',
            title: 'workit (daftpunk flip)',
            duration: 190,
            genre: 'Electronic',
            user: { name: 'chromonicci.' },
            artwork: { '480x480': 'https://art.example/480.jpg' },
          },
        ],
      },
    )
    const search = source['search'] as (
      keyword: string,
      page: number,
      limit: number,
    ) => Promise<unknown>
    const songs = parseSearchResult(await search('daft', 1, 30))
    expect(songs).toHaveLength(1)
    expect(songs[0]).toMatchObject({
      songmid: 'vZJJz',
      name: 'workit (daftpunk flip)',
      singer: 'chromonicci.',
      album: 'Electronic',
      interval: 190,
      img: 'https://art.example/480.jpg',
      source: 'audius',
    })
    const getMusicUrl = source['getMusicUrl'] as (songmid: string) => unknown
    expect(parseUrlResult(getMusicUrl('vZJJz'))).toBe(
      'https://api.audius.co/v1/tracks/vZJJz/stream?app_name=LIKEY',
    )
  })

  it('iTunes 源：搜索映射与 previewUrl 查找', async () => {
    const { source, fetchStub } = loadSource(itunesCode)
    fetchStub.respond(
      'https://itunes.apple.com/search?term=jay%20chou&media=music&entity=song&limit=30&offset=0',
      {
        results: [
          {
            trackId: 1721450037,
            trackName: 'Qi-Li-Xiang',
            artistName: 'Jay Chou',
            collectionName: 'Common Jasmin Orange',
            trackTimeMillis: 297200,
            artworkUrl100: 'https://art.example/100.jpg',
          },
        ],
      },
    )
    fetchStub.respond('https://itunes.apple.com/lookup?id=1721450037', {
      results: [{ previewUrl: 'https://audio-ssl.itunes.apple.com/preview.mp3' }],
    })
    const search = source['search'] as (
      keyword: string,
      page: number,
      limit: number,
    ) => Promise<unknown>
    const songs = parseSearchResult(await search('jay chou', 1, 30))
    expect(songs).toHaveLength(1)
    expect(songs[0]).toMatchObject({
      songmid: '1721450037',
      name: 'Qi-Li-Xiang',
      singer: 'Jay Chou',
      interval: 297,
      source: 'itunes-preview',
    })
    const getMusicUrl = source['getMusicUrl'] as (songmid: string) => Promise<unknown>
    expect(parseUrlResult(await getMusicUrl('1721450037'))).toBe(
      'https://audio-ssl.itunes.apple.com/preview.mp3',
    )
  })

  it('错误路径：Audius HTTP 错误被抛出', async () => {
    const { source, fetchStub } = loadSource(audiusCode)
    fetchStub.respond(
      'https://api.audius.co/v1/tracks/search?query=x&app_name=LIKEY&offset=0&limit=30',
      {},
      false,
    )
    const search = source['search'] as (
      keyword: string,
      page: number,
      limit: number,
    ) => Promise<unknown>
    await expect(search('x', 1, 30)).rejects.toThrow('Audius HTTP 500')
  })
})
