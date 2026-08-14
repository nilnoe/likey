import { convertFileSrc } from '@tauri-apps/api/core'
import { fnv1a } from './hash'
import type { LibraryTrack, TrackMeta } from './types'

/** Rust TrackMeta → 前端 LibraryTrack（id = fnv1a(path)，fileUrl = 资产协议）。 */
export function toLibraryTrack(meta: TrackMeta): LibraryTrack {
  return {
    id: fnv1a(meta.path),
    path: meta.path,
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    duration: meta.durationSecs,
    format: meta.format,
    hasCover: meta.hasCover,
    fileUrl: convertFileSrc(meta.path),
  }
}

/** LibraryTrack → 队列曲目（字节经资产协议 URL 按需读取）。 */
export function toPlaylistTrack(track: LibraryTrack) {
  return {
    id: track.id,
    name: `${track.title} - ${track.artist}`,
    source: { kind: 'url', url: track.fileUrl } as const,
  }
}
