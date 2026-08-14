/**
 * Range 分块抓取（googlevideo 等要求有限 Range 头的 CDN）。
 * 纯逻辑 + 可注入 fetch 实现（单测友好）。
 */

export interface RangeFetchImpl {
  (
    url: string,
    init: { headers: Record<string, string> },
  ): Promise<{
    readonly ok: boolean
    readonly status: number
    arrayBuffer(): Promise<ArrayBuffer>
    getHeader(name: string): string | null
  }>
}

/** 解析 Content-Range: "bytes 0-1023/5152105" → 5152105。 */
export function parseContentRangeTotal(value: string | null): number | null {
  if (value === null) return null
  const match = /bytes \d+-\d+\/(\d+)/.exec(value)
  if (match === null) return null
  const total = Number(match[1])
  return Number.isFinite(total) && total > 0 ? total : null
}

/** 全文件分块区间 [start, end]（含端点）。 */
export function buildChunkRanges(
  total: number,
  chunkSize: number,
): ReadonlyArray<readonly [number, number]> {
  const ranges: Array<[number, number]> = []
  for (let start = 0; start < total; start += chunkSize) {
    ranges.push([start, Math.min(start + chunkSize - 1, total - 1)])
  }
  return ranges
}

/** googlevideo 系主机判定。 */
export const GOOGLEVIDEO_HOST_RE = /(^|\.)googlevideo\.com$/

export function isGooglevideoHost(hostname: string): boolean {
  return GOOGLEVIDEO_HOST_RE.test(hostname)
}

/**
 * 分块感知抓取：
 * 1. 探测 bytes=0-0 → Content-Range 总长（不支持 Range 的服务器返回 200 整包直接返回）
 * 2. 按 chunkSize 逐块请求并拼接（googlevideo 拒绝无 Range/整包大请求）
 */
export async function fetchBytesRangeAware(
  impl: RangeFetchImpl,
  url: string,
  headers: Record<string, string>,
  chunkSize = 512 * 1024,
): Promise<ArrayBuffer> {
  const probe = await impl(url, { headers: { ...headers, Range: 'bytes=0-0' } })
  if (!probe.ok) throw new Error(`HTTP ${probe.status}`)
  if (probe.status === 200) {
    return probe.arrayBuffer()
  }
  const total = parseContentRangeTotal(probe.getHeader('content-range'))
  if (total === null) throw new Error('无法确定文件总长（无 Content-Range）')

  const chunks: ArrayBuffer[] = []
  for (const [start, end] of buildChunkRanges(total, chunkSize)) {
    const response = await impl(url, { headers: { ...headers, Range: `bytes=${start}-${end}` } })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    chunks.push(await response.arrayBuffer())
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(new Uint8Array(chunk), offset)
    offset += chunk.byteLength
  }
  return merged.buffer
}
