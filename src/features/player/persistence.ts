import { load, type Store } from '@tauri-apps/plugin-store'
import type { PlaylistTrack, RepeatMode } from '../../core/player/Queue'

const STORE_FILE = 'likey.json'

interface PersistedQueueTrack {
  readonly id: string
  readonly name: string
  readonly url: string
}

export interface PersistedQueue {
  readonly tracks: readonly PersistedQueueTrack[]
  readonly index: number
  readonly repeat: RepeatMode
  readonly shuffle: boolean
}

export interface RestoredQueue {
  readonly tracks: readonly PlaylistTrack[]
  readonly index: number
  readonly repeat: RepeatMode
  readonly shuffle: boolean
}

let storePromise: Promise<Store | null> | null = null

/** 纯 Web 环境（无 Tauri IPC）静默降级为 null，持久化跳过。 */
function getStore(): Promise<Store | null> {
  if (storePromise === null) {
    storePromise = load(STORE_FILE, { autoSave: true }).catch(() => null)
  }
  return storePromise
}

/** 队列快照 → 持久化（仅 url 来源曲目可持久化；File 句柄会话后失效）。 */
export async function saveQueue(snapshot: {
  readonly tracks: readonly PlaylistTrack[]
  readonly index: number
  readonly repeat: RepeatMode
  readonly shuffle: boolean
}): Promise<void> {
  const store = await getStore()
  if (store === null) return
  const tracks: PersistedQueueTrack[] = snapshot.tracks
    .filter((t) => t.source.kind === 'url')
    .map((t) => ({
      id: t.id,
      name: t.name,
      url: t.source.kind === 'url' ? t.source.url : '',
    }))
  const persisted: PersistedQueue = {
    tracks,
    index: snapshot.index,
    repeat: snapshot.repeat,
    shuffle: snapshot.shuffle,
  }
  await store.set('queue', persisted)
  await store.save()
}

export async function loadQueue(): Promise<RestoredQueue | null> {
  const store = await getStore()
  if (store === null) return null
  const persisted = await store.get<PersistedQueue>('queue')
  if (persisted === null || persisted === undefined) return null
  const tracks: PlaylistTrack[] = persisted.tracks.map((t) => ({
    id: t.id,
    name: t.name,
    source: { kind: 'url', url: t.url },
  }))
  return { tracks, index: persisted.index, repeat: persisted.repeat, shuffle: persisted.shuffle }
}

/** 歌词偏移按曲目持久化（±500ms 步进校准）。 */
export async function saveLyricsOffset(trackId: string, offsetMs: number): Promise<void> {
  const store = await getStore()
  if (store === null) return
  const offsets = (await store.get<Record<string, number>>('lyricsOffsets')) ?? {}
  if (offsetMs === 0) {
    delete offsets[trackId]
  } else {
    offsets[trackId] = offsetMs
  }
  await store.set('lyricsOffsets', offsets)
  await store.save()
}

export async function loadLyricsOffset(trackId: string): Promise<number> {
  const store = await getStore()
  if (store === null) return 0
  const offsets = (await store.get<Record<string, number>>('lyricsOffsets')) ?? {}
  return offsets[trackId] ?? 0
}

/** 音乐库目录持久化（重启自动重扫）。 */
export async function saveLibraryDir(dir: string | null): Promise<void> {
  const store = await getStore()
  if (store === null) return
  await store.set('libraryDir', dir)
  await store.save()
}

export async function loadLibraryDir(): Promise<string | null> {
  const store = await getStore()
  if (store === null) return null
  return (await store.get<string>('libraryDir')) ?? null
}

/** 用户音源脚本（{ id, name, code } 列表）。 */
export interface PersistedSource {
  readonly id: string
  readonly name: string
  readonly code: string
}

export async function saveOnlineSources(sources: readonly PersistedSource[]): Promise<void> {
  const store = await getStore()
  if (store === null) return
  await store.set('onlineSources', sources)
  await store.save()
}

export async function loadOnlineSources(): Promise<readonly PersistedSource[]> {
  const store = await getStore()
  if (store === null) return []
  return (await store.get<readonly PersistedSource[]>('onlineSources')) ?? []
}

/** YouTube 音源 Cookie 来源（浏览器名，'' = 无）。 */
export async function saveYoutubeCookies(browser: string): Promise<void> {
  const store = await getStore()
  if (store === null) return
  await store.set('youtubeCookies', browser)
  await store.save()
}

export async function loadYoutubeCookies(): Promise<string> {
  const store = await getStore()
  if (store === null) return ''
  return (await store.get<string>('youtubeCookies')) ?? ''
}

/** 已下载曲目档案（含溯源与完整元数据；新字段可选，兼容旧记录）。 */
export interface PersistedDownload {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly downloadedAt: number
  readonly sourceId?: string
  readonly songmid?: string
  readonly quality?: string
  readonly album?: string
  readonly duration?: number
  readonly artworkPath?: string
  readonly lyrics?: string
}

export async function saveDownloads(items: readonly PersistedDownload[]): Promise<void> {
  const store = await getStore()
  if (store === null) return
  await store.set('downloads', items)
  await store.save()
}

export async function loadDownloads(): Promise<readonly PersistedDownload[]> {
  const store = await getStore()
  if (store === null) return []
  return (await store.get<readonly PersistedDownload[]>('downloads')) ?? []
}
