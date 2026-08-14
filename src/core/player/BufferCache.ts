/**
 * 通用 LRU 缓存（Map 插入序 = 最近使用序）。
 * 音频缓冲场景：容量 2 ≈ 84MB 上限（44.1kHz 立体声 4 分钟曲目全量解码）。
 */
export class BufferCache<T> {
  private readonly entries = new Map<string, T>()
  private readonly capacity: number

  constructor(capacity: number) {
    if (capacity < 1) {
      throw new Error('BufferCache 容量必须 ≥ 1')
    }
    this.capacity = capacity
  }

  /** 命中时把条目移到最近使用端。 */
  get(key: string): T | undefined {
    const value = this.entries.get(key)
    if (value === undefined) return undefined
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  /** 存入并淘汰最久未用条目；返回被淘汰的 key（无淘汰返回 null）。 */
  put(key: string, value: T): string | null {
    this.entries.delete(key)
    this.entries.set(key, value)
    let evicted: string | null = null
    if (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) {
        this.entries.delete(oldest)
        evicted = oldest
      }
    }
    return evicted
  }

  clear(): void {
    this.entries.clear()
  }

  get size(): number {
    return this.entries.size
  }
}
