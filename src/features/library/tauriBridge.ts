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
