/**
 * FNV-1a 32 位哈希（十六进制）。
 * 规范化路径 → 稳定 id：跨会话一致，扫描/播放列表持久化依赖此契约。
 */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
