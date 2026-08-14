import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaylistTrack } from '../../core/player/Queue'
import {
  loadDownloads,
  loadLibraryDir,
  loadLyricsOffset,
  loadQueue,
  saveDownloads,
  saveLibraryDir,
  saveLyricsOffset,
  saveQueue,
} from './persistence'

const mocks = vi.hoisted(() => {
  const state = new Map<string, unknown>()
  return {
    state,
    set: vi.fn(async (key: string, value: unknown) => {
      state.set(key, value)
    }),
    get: vi.fn(async (key: string) => state.get(key) ?? null),
    save: vi.fn(async () => {}),
  }
})

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(async () => ({ set: mocks.set, get: mocks.get, save: mocks.save })),
}))

beforeEach(() => {
  mocks.state.clear()
  mocks.set.mockClear()
  mocks.save.mockClear()
})

function makeQueueTracks(): PlaylistTrack[] {
  return [
    { id: 'a', name: 'A', source: { kind: 'url', url: 'asset://a' } },
    { id: 'b', name: 'B', source: { kind: 'file', file: new File(['x'], 'b.mp3') } },
    { id: 'c', name: 'C', source: { kind: 'url', url: 'asset://c' } },
  ]
}

describe('队列持久化', () => {
  it('round-trips url tracks and drops file tracks', async () => {
    await saveQueue({ tracks: makeQueueTracks(), index: 1, repeat: 'all', shuffle: true })
    expect(mocks.save).toHaveBeenCalled()
    const restored = await loadQueue()
    expect(restored).not.toBeNull()
    expect(restored?.tracks.map((t) => t.id)).toEqual(['a', 'c'])
    expect(restored?.index).toBe(1)
    expect(restored?.repeat).toBe('all')
    expect(restored?.shuffle).toBe(true)
    expect(restored?.tracks[0]?.source).toEqual({ kind: 'url', url: 'asset://a' })
  })

  it('returns null when nothing persisted', async () => {
    expect(await loadQueue()).toBeNull()
  })
})

describe('歌词偏移持久化', () => {
  it('saves and loads per-track offset, deletes on zero', async () => {
    await saveLyricsOffset('t1', 500)
    expect(await loadLyricsOffset('t1')).toBe(500)
    expect(await loadLyricsOffset('t2')).toBe(0)
    await saveLyricsOffset('t1', 0)
    expect(await loadLyricsOffset('t1')).toBe(0)
  })
})

describe('音乐库目录持久化', () => {
  it('round-trips directory including null', async () => {
    await saveLibraryDir('/Users/x/Music')
    expect(await loadLibraryDir()).toBe('/Users/x/Music')
    await saveLibraryDir(null)
    expect(await loadLibraryDir()).toBeNull()
  })
})

describe('下载列表持久化', () => {
  it('round-trips downloaded items including archive fields', async () => {
    await saveDownloads([
      {
        id: 'audius:vZJJz',
        name: 'workit - chromonicci.',
        path: '/x/y.mp3',
        downloadedAt: 42,
        sourceId: 'audius',
        songmid: 'vZJJz',
        quality: '320k',
        album: 'Electronic',
        duration: 190,
        artworkPath: '/x/covers/y.jpg',
        lyrics: '[00:01.00]歌词',
      },
    ])
    const restored = await loadDownloads()
    expect(restored).toHaveLength(1)
    expect(restored[0]).toMatchObject({
      id: 'audius:vZJJz',
      sourceId: 'audius',
      songmid: 'vZJJz',
      quality: '320k',
      artworkPath: '/x/covers/y.jpg',
      lyrics: '[00:01.00]歌词',
    })
    // 旧记录（无新字段）也能读回
    await saveDownloads([{ id: 'old', name: 'old', path: '/x/old.mp3', downloadedAt: 1 }])
    expect((await loadDownloads())[0]).toEqual({
      id: 'old',
      name: 'old',
      path: '/x/old.mp3',
      downloadedAt: 1,
    })
  })

  it('returns empty list when nothing persisted', async () => {
    expect(await loadDownloads()).toEqual([])
  })
})
