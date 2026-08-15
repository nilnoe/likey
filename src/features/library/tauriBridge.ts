import { invoke, Channel } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { TrackMeta } from '../../core/library/types'

/** 弹出系统目录选择框；取消返回 null。 */
export async function pickDirectory(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择音乐目录',
  })
  return typeof selected === 'string' ? selected : null
}

/** 扫描目录（Rust 后台线程），进度经 Channel 回推。 */
export async function scanDirectory(
  path: string,
  recursive: boolean,
  onProgress: (done: number, total: number) => void,
): Promise<TrackMeta[]> {
  const progress = new Channel<{ done: number; total: number }>()
  progress.onmessage = (msg) => {
    onProgress(msg.done, msg.total)
  }
  return invoke<TrackMeta[]>('scan_directory', { path, recursive, onProgress: progress })
}

/** 读取内嵌封面字节（Vec<u8> 经 JSON 数组返回；构造 ArrayBuffer 保证可作 BlobPart）。 */
export async function readCoverBytes(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = await invoke<number[]>('read_cover', { path })
  const buffer = new ArrayBuffer(bytes.length)
  const view = new Uint8Array(buffer)
  view.set(bytes)
  return view
}

export interface DownloadProgressMsg {
  readonly downloaded: number
  readonly total: number
}

export interface DownloadResult {
  readonly path: string
  readonly artworkPath: string | null
}

export interface DownloadMeta {
  readonly title: string
  readonly artist: string
  readonly album: string
  readonly artworkUrl?: string
  readonly lyrics?: string
  /** m4a 下载后经 ffmpeg 转码 mp3（访达对 mp3 内嵌封面显示更稳）。 */
  readonly transcodeMp3?: boolean
}

/**
 * 下载音源曲目到 ~/Music/Mymusic（Rust reqwest 流式 + 进度 Channel），返回音频/封面路径。
 * 文件已存在时直接返回既有路径（跳过重复下载）；
 * meta 元数据写入文件标签（含封面嵌入 + 歌词帧），封面同时落盘 covers/。
 */
export async function downloadFile(
  url: string,
  fileName: string,
  onProgress: (downloaded: number, total: number) => void,
  meta?: DownloadMeta,
): Promise<DownloadResult> {
  const progress = new Channel<DownloadProgressMsg>()
  progress.onmessage = (msg) => {
    onProgress(msg.downloaded, msg.total)
  }
  return invoke<DownloadResult>('download_file', {
    url,
    fileName,
    onProgress: progress,
    meta: meta ?? null,
  })
}

/** 删除下载文件（Rust 侧校验路径必须位于下载目录内）。 */
export async function deleteDownload(path: string): Promise<void> {
  await invoke('delete_download', { path })
}

/** 当前下载目录路径（~/Music/Mymusic；前端路径迁移/展示用）。 */
export async function getDownloadsDir(): Promise<string> {
  return invoke<string>('get_downloads_dir')
}

/** YouTube 搜索结果音轨（yt-dlp sidecar 映射）。 */
export interface YtTrack {
  readonly videoId: string
  readonly title: string
  readonly artist: string
  readonly duration: number
  readonly thumbnail: string
}

/**
 * YouTube 搜索（Rust 调 yt-dlp；cookies 为浏览器 Cookie 来源，防反爬拦截）。
 */
export async function ytdlSearch(query: string, limit = 20, cookies?: string): Promise<YtTrack[]> {
  return invoke<YtTrack[]>('ytdl_search', { query, limit, cookies: cookies ?? null })
}

/** YouTube 取流地址（强制 m4a/AAC，WKWebView 不支持 Opus/WebM；可选 Cookie）。 */
export async function ytdlUrl(videoId: string, cookies?: string): Promise<string> {
  return invoke<string>('ytdl_url', { videoId, cookies: cookies ?? null })
}

/** YouTube 字幕歌词（yt-dlp 抓 VTT → LRC；无字幕返回 null；可选 Cookie）。 */
export async function ytdlLyrics(videoId: string, cookies?: string): Promise<string | null> {
  return invoke<string | null>('ytdl_lyrics', { videoId, cookies: cookies ?? null })
}
