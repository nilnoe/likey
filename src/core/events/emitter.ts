export type Unsubscribe = () => void

/**
 * 极简类型安全事件总线（core 层通用）。
 * 事件名 → 载荷类型由泛型 T 约束，emit 时类型检查。
 */
export class Emitter<T extends object> {
  private readonly listeners = new Map<keyof T, Set<(payload: never) => void>>()

  on<K extends keyof T>(event: K, callback: (payload: T[K]) => void): Unsubscribe {
    let set = this.listeners.get(event)
    if (set === undefined) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(callback as (payload: never) => void)
    return () => {
      set.delete(callback as (payload: never) => void)
    }
  }

  emit<K extends keyof T>(event: K, payload: T[K]): void {
    const set = this.listeners.get(event)
    if (set === undefined) return
    for (const callback of set) {
      callback(payload as never)
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
