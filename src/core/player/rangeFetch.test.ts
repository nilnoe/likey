import { describe, expect, it, vi } from 'vitest'
import {
  buildChunkRanges,
  fetchBytesRangeAware,
  isGooglevideoHost,
  parseContentRangeTotal,
  type RangeFetchImpl,
} from './rangeFetch'

describe('parseContentRangeTotal', () => {
  it('parses standard content-range', () => {
    expect(parseContentRangeTotal('bytes 0-1023/5152105')).toBe(5152105)
    expect(parseContentRangeTotal('bytes 0-0/42')).toBe(42)
    expect(parseContentRangeTotal(null)).toBeNull()
    expect(parseContentRangeTotal('garbage')).toBeNull()
    expect(parseContentRangeTotal('bytes 0-10/0')).toBeNull()
  })
})

describe('buildChunkRanges', () => {
  it('splits into closed chunks covering the whole file', () => {
    expect(buildChunkRanges(10, 4)).toEqual([
      [0, 3],
      [4, 7],
      [8, 9],
    ])
    expect(buildChunkRanges(3, 4)).toEqual([[0, 2]])
    expect(buildChunkRanges(8, 4)).toEqual([
      [0, 3],
      [4, 7],
    ])
  })
})

describe('isGooglevideoHost', () => {
  it('matches googlevideo hosts only', () => {
    expect(isGooglevideoHost('rr1---sn-abc.googlevideo.com')).toBe(true)
    expect(isGooglevideoHost('googlevideo.com')).toBe(true)
    expect(isGooglevideoHost('evilgooglevideo.com')).toBe(false)
    expect(isGooglevideoHost('api.audius.co')).toBe(false)
  })
})

describe('fetchBytesRangeAware', () => {
  function makeImpl(total: number, records: Array<{ range: string | null }>): RangeFetchImpl {
    return vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      const range = init.headers['Range'] ?? null
      records.push({ range })
      const isProbe = range === 'bytes=0-0'
      if (isProbe) {
        return {
          ok: true,
          status: 206,
          getHeader: () => `bytes 0-0/${total}`,
          arrayBuffer: async () => new ArrayBuffer(0),
        }
      }
      const match = /bytes=(\d+)-(\d+)/.exec(range ?? '')
      const start = Number(match?.[1])
      const end = Number(match?.[2])
      const bytes = new Uint8Array(end - start + 1)
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = (start + i) % 251
      }
      return {
        ok: true,
        status: 206,
        getHeader: () => `bytes ${start}-${end}/${total}`,
        arrayBuffer: async () => bytes.buffer,
      }
    })
  }

  it('probes total then fetches chunks and merges correctly', async () => {
    const records: Array<{ range: string | null }> = []
    const bytes = await fetchBytesRangeAware(makeImpl(10, records), 'https://x/v', {}, 4)
    expect(new Uint8Array(bytes)).toHaveLength(10)
    // 字节序正确：每个位置 = 索引 mod 251
    const view = new Uint8Array(bytes)
    for (let i = 0; i < 10; i++) {
      expect(view[i]).toBe(i % 251)
    }
    expect(records.map((r) => r.range)).toEqual([
      'bytes=0-0',
      'bytes=0-3',
      'bytes=4-7',
      'bytes=8-9',
    ])
  })

  it('returns full body when server responds 200 to probe', async () => {
    const impl: RangeFetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      getHeader: () => null,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }))
    const bytes = await fetchBytesRangeAware(impl, 'https://x/v', {})
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('throws on failed chunk and on missing total', async () => {
    const failing: RangeFetchImpl = vi.fn(async () => ({
      ok: false,
      status: 403,
      getHeader: () => null,
      arrayBuffer: async () => new ArrayBuffer(0),
    }))
    await expect(fetchBytesRangeAware(failing, 'https://x/v', {})).rejects.toThrow('HTTP 403')

    const noTotal: RangeFetchImpl = vi.fn(async () => ({
      ok: true,
      status: 206,
      getHeader: () => null,
      arrayBuffer: async () => new ArrayBuffer(0),
    }))
    await expect(fetchBytesRangeAware(noTotal, 'https://x/v', {})).rejects.toThrow('Content-Range')
  })
})
