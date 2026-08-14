import type { AudioFormat } from '../player/probe'

/** 音轨元数据（与 Rust TrackMeta 的 camelCase 序列化对齐）。 */
export interface TrackMeta {
  readonly path: string
  readonly title: string
  readonly artist: string
  readonly album: string
  readonly durationSecs: number
  readonly format: AudioFormat
  readonly hasCover: boolean
  readonly sizeBytes: number
  readonly modifiedMs: number
}

/** 音乐库音轨（前端领域模型）。 */
export interface LibraryTrack {
  /** fnv1a(path)，跨会话稳定 */
  readonly id: string
  readonly path: string
  readonly title: string
  readonly artist: string
  readonly album: string
  /** 秒 */
  readonly duration: number
  readonly format: AudioFormat
  readonly hasCover: boolean
  /** 资产协议 URL（convertFileSrc），音频字节入口 */
  readonly fileUrl: string
}

export type LibraryScanState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'scanning'; readonly done: number; readonly total: number }
  | { readonly kind: 'done'; readonly added: number; readonly failed: number }
  | { readonly kind: 'error'; readonly message: string }
