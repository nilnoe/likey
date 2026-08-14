/**
 * .js 音源协议（lx-music 自定义音源兼容）。
 * 脚本约定：定义全局 `window.source = { search, getMusicUrl, getLyric }`。
 * 本模块为纯协议/消息/校验逻辑（无 DOM 依赖，可单测）。
 */

export type MusicQuality = '128k' | '320k' | 'flac'

export const MUSIC_QUALITIES: readonly MusicQuality[] = ['128k', '320k', 'flac']

export interface SourceSong {
  readonly songmid: string
  readonly name: string
  readonly singer: string
  readonly album: string
  /** 时长（秒），未知为 0 */
  readonly interval: number
  readonly img: string
  /** 音源标识 */
  readonly source: string
}

/** 校验/规范化搜索结果：非法条目丢弃，字段补默认值。 */
export function parseSearchResult(value: unknown): SourceSong[] {
  if (!Array.isArray(value)) return []
  const songs: SourceSong[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const songmid = typeof record['songmid'] === 'string' ? record['songmid'] : null
    const name = typeof record['name'] === 'string' ? record['name'] : null
    if (songmid === null || name === null || songmid === '' || name === '') continue
    songs.push({
      songmid,
      name,
      singer: typeof record['singer'] === 'string' ? record['singer'] : '',
      album: typeof record['album'] === 'string' ? record['album'] : '',
      interval:
        typeof record['interval'] === 'number' && Number.isFinite(record['interval'])
          ? record['interval']
          : 0,
      img: typeof record['img'] === 'string' ? record['img'] : '',
      source: typeof record['source'] === 'string' ? record['source'] : 'unknown',
    })
  }
  return songs
}

/** 播放地址校验：只接受非空字符串。 */
export function parseUrlResult(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** 歌词校验：只接受字符串（LRC 文本）。 */
export function parseLyricResult(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

// --- 主线程 ↔ 沙箱 iframe 消息协议（postMessage，结构化克隆） ---

export type SourceRuntimeMessage =
  | { readonly type: 'ready'; readonly ok: boolean; readonly error?: string }
  | {
      readonly type: 'call'
      readonly callId: string
      readonly method: string
      readonly args: readonly unknown[]
    }
  | {
      readonly type: 'call-result'
      readonly callId: string
      readonly ok: boolean
      readonly value?: unknown
      readonly error?: string
    }
  | {
      readonly type: 'fetch'
      readonly fetchId: string
      readonly url: string
      readonly options?: {
        readonly method?: string
        readonly headers?: Record<string, string>
        readonly body?: string
      }
    }
  | {
      readonly type: 'fetch-response'
      readonly fetchId: string
      readonly ok: boolean
      readonly status: number
      readonly headers: Record<string, string>
      readonly body?: ArrayBuffer
    }
  | { readonly type: 'config'; readonly payload: unknown }

/** 消息鉴别（对外部 postMessage 数据做类型收窄）。 */
export function isSourceRuntimeMessage(value: unknown): value is SourceRuntimeMessage {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as Record<string, unknown>)['type']
  return (
    type === 'ready' ||
    type === 'call' ||
    type === 'call-result' ||
    type === 'fetch' ||
    type === 'fetch-response' ||
    type === 'config'
  )
}
