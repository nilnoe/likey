/** 曲目字节来源：本地文件句柄（拖放/文件选择）或资产协议 URL（音乐库）。 */
export type TrackSource =
  { readonly kind: 'file'; readonly file: File } | { readonly kind: 'url'; readonly url: string }

/** 播放列表条目。 */
export interface PlaylistTrack {
  readonly id: string
  readonly name: string
  readonly source: TrackSource
}

/** 曲目引用（播放内核加载契约，与缓存 key 同源）。 */
export interface TrackRef {
  readonly id: string
  readonly name: string
}

/** 按来源读取音频字节（默认实现；单测可注入替代）。 */
export async function defaultReadSource(source: TrackSource): Promise<ArrayBuffer> {
  if (source.kind === 'file') {
    return source.file.arrayBuffer()
  }
  const response = await fetch(source.url)
  if (!response.ok) {
    throw new Error(`音频读取失败: HTTP ${response.status}`)
  }
  return response.arrayBuffer()
}

export type RepeatMode = 'off' | 'all' | 'one'

/** mulberry32：32 位种子确定性 PRNG（洗牌顺序可复现，测试友好）。 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates + mulberry32：给定长度与种子生成确定性洗牌顺序。 */
export function createShuffleOrder(length: number, seed: number): readonly number[] {
  const order: number[] = Array.from({ length }, (_, i) => i)
  const rng = mulberry32(seed)
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const a = order[i]
    const b = order[j]
    order[i] = b ?? 0
    order[j] = a ?? 0
  }
  return order
}

/** current 在 order 中的位置；order=null 表示顺序播放（位置即索引，越界返回 -1）。 */
function positionInOrder(order: readonly number[] | null, current: number, count: number): number {
  if (order === null) {
    return current >= 0 && current < count ? current : -1
  }
  return order.indexOf(current)
}

/**
 * 自动前进（曲目自然播完）：
 * repeat='off' 到底返回 null（队列结束）；'all' 回绕；'one' 由控制器另行处理。
 */
export function advanceAuto(
  count: number,
  current: number,
  order: readonly number[] | null,
  repeat: RepeatMode,
): number | null {
  if (count <= 0) return null
  const pos = positionInOrder(order, current, count)
  if (pos < 0) return null
  if (pos + 1 < count) {
    return order === null ? pos + 1 : (order[pos + 1] ?? null)
  }
  return repeat === 'all' ? (order === null ? 0 : (order[0] ?? null)) : null
}

/** 手动 next：无条件回绕（repeat 模式不影响手动切歌）。 */
export function advanceManual(
  count: number,
  current: number,
  order: readonly number[] | null,
): number | null {
  if (count <= 0) return null
  const pos = positionInOrder(order, current, count)
  if (pos < 0) return null
  const nextPos = (pos + 1) % count
  return order === null ? nextPos : (order[nextPos] ?? null)
}

/** 手动 prev：无条件回绕。 */
export function retreatManual(
  count: number,
  current: number,
  order: readonly number[] | null,
): number | null {
  if (count <= 0) return null
  const pos = positionInOrder(order, current, count)
  if (pos < 0) return null
  const prevPos = (pos - 1 + count) % count
  return order === null ? prevPos : (order[prevPos] ?? null)
}
