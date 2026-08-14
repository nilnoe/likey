/** 音源下载相关纯逻辑（命名规范 + 路径迁移，可单测）。 */

/** 下载文件名规范：作者 - 歌名（作者缺失时仅歌名）。 */
export function buildDownloadFileName(singer: string, name: string): string {
  const artist = singer.trim()
  const title = name.trim() || '未命名曲目'
  return artist === '' ? title : `${artist} - ${title}`
}

const LEGACY_DOWNLOADS_MARKER = 'Application Support/com.likey.app/downloads'

/** 旧下载目录路径 → 新目录路径修复（仅命中旧目录标记时替换；其余原样返回）。 */
export function fixLegacyDownloadPath(path: string, newDir: string): string {
  if (!path.includes(LEGACY_DOWNLOADS_MARKER)) return path
  const base = path.split('/').pop() ?? path
  return `${newDir.replace(/\/+$/, '')}/${base}`
}
