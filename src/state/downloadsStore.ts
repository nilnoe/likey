import { create } from 'zustand'
import { fixLegacyDownloadPath } from '../core/library/downloads'
import { getDownloadsDir } from '../features/library/tauriBridge'
import type { PersistedDownload } from '../features/player/persistence'
import { loadDownloads, saveDownloads } from '../features/player/persistence'

/** 下载列表 UI 状态（持久化到 plugin-store）。 */
interface DownloadsStoreState {
  readonly items: readonly PersistedDownload[]
  readonly loaded: boolean
  restore(): Promise<void>
  add(item: PersistedDownload): void
  remove(id: string): PersistedDownload | undefined
}

function persist(items: readonly PersistedDownload[]): void {
  void saveDownloads(items)
}

export const useDownloadsStore = create<DownloadsStoreState>((set, get) => ({
  items: [],
  loaded: false,

  restore: async () => {
    if (get().loaded) return
    let items = await loadDownloads()
    // 旧下载目录（应用数据目录）→ ~/Music/Mymusic 路径修复
    try {
      const dir = await getDownloadsDir()
      items = items.map((item) => ({ ...item, path: fixLegacyDownloadPath(item.path, dir) }))
    } catch {
      // 纯 Web 环境无 Tauri IPC：保持原路径
    }
    set({ items, loaded: true })
  },

  add: (item) => {
    const items = get().items.some((it) => it.id === item.id)
      ? get().items.map((it) => (it.id === item.id ? item : it))
      : [item, ...get().items]
    set({ items })
    persist(items)
  },

  remove: (id) => {
    const target = get().items.find((it) => it.id === id)
    const items = get().items.filter((it) => it.id !== id)
    set({ items })
    persist(items)
    return target
  },
}))
