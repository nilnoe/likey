/**
 * 会话级过期缓存：给 YouTube 请求降频（减少对上游的重复请求，降低触发风控的概率）。
 * 通用泛型实现，注入时钟便于单测。
 */
export class ExpiringCache<T> {
  private readonly map = new Map<string, { value: T; expiresAt: number }>()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(ttlMs: number, now: () => number = Date.now) {
    this.ttlMs = ttlMs
    this.now = now
  }

  get(key: string): T | undefined {
    const entry = this.map.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= this.now()) {
      this.map.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    this.map.set(key, { value, expiresAt: this.now() + this.ttlMs })
  }

  clear(): void {
    this.map.clear()
  }
}

/** YouTube 流地址缓存：googlevideo 链接约 6h 有效，4h TTL 保守复用。 */
export const STREAM_URL_TTL_MS = 4 * 60 * 60 * 1000

/** YouTube 搜索缓存：10 分钟内重复搜索直接复用结果。 */
export const SEARCH_TTL_MS = 10 * 60 * 1000
