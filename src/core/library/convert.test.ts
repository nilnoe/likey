import { afterEach, describe, expect, it, vi } from 'vitest'
import { toLibraryTrack, toPlaylistTrack } from './convert'
import type { TrackMeta } from './types'

const fakeConvertFileSrc = vi.fn((path: string) => `asset://localhost/${path}`)

function stubTauriWindow(): void {
  vi.stubGlobal('window', {
    __TAURI_INTERNALS__: { convertFileSrc: fakeConvertFileSrc },
  })
}

function makeMeta(): TrackMeta {
  return {
    path: '/Users/mike/Music/a.mp3',
    title: 'Title',
    artist: 'Artist',
    album: 'Album',
    durationSecs: 123.5,
    format: 'mp3',
    hasCover: true,
    sizeBytes: 1024,
    modifiedMs: 42,
  }
}

describe('toLibraryTrack / toPlaylistTrack', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    fakeConvertFileSrc.mockClear()
  })

  it('converts meta with stable fnv1a id and asset URL', () => {
    stubTauriWindow()
    const track = toLibraryTrack(makeMeta())
    expect(track.id).toMatch(/^[0-9a-f]{8}$/)
    expect(track.duration).toBe(123.5)
    // stub 直通路径（真实 Tauri 内部会 encodeURIComponent）
    expect(track.fileUrl).toBe('asset://localhost//Users/mike/Music/a.mp3')
    expect(fakeConvertFileSrc).toHaveBeenCalledWith('/Users/mike/Music/a.mp3', 'asset')
  })

  it('converts to playlist track with url source', () => {
    stubTauriWindow()
    const track = toLibraryTrack(makeMeta())
    const playlistTrack = toPlaylistTrack(track)
    expect(playlistTrack).toEqual({
      id: track.id,
      name: 'Title - Artist',
      source: { kind: 'url', url: track.fileUrl },
    })
  })
})
