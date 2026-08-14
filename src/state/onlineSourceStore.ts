import { create } from 'zustand'
import type { PersistedSource } from '../features/player/persistence'
import { loadOnlineSources, saveOnlineSources } from '../features/player/persistence'

export interface OnlineSource extends PersistedSource {
  readonly builtin: boolean
  /** 内置源的脚本资产路径（运行时 fetch；用户源直接内嵌 code）。 */
  readonly assetPath?: string
  /** 原生源（不经沙箱运行时，走 Rust 命令）；目前仅 YouTube(yt-dlp)。 */
  readonly native?: 'youtube'
}

export const BUILTIN_SOURCES: readonly OnlineSource[] = [
  {
    id: 'youtube',
    name: '内置 · YouTube（yt-dlp，全曲库 256k）',
    code: '',
    builtin: true,
    native: 'youtube',
  },
  {
    id: 'audius',
    name: '内置 · Audius（免费音乐平台）',
    code: '',
    builtin: true,
    assetPath: '/sources/audius.js',
  },
  {
    id: 'itunes-preview',
    name: '内置 · iTunes 试听（30s 片段）',
    code: '',
    builtin: true,
    assetPath: '/sources/itunes.js',
  },
  {
    id: 'demo-library',
    name: '内置 · 本地音乐库（示例）',
    code: '',
    builtin: true,
    assetPath: '/sources/example.js',
  },
]

/** 音源管理 UI 状态：内置源 + 用户导入源（持久化）。 */
interface OnlineSourceStoreState {
  readonly sources: readonly OnlineSource[]
  readonly activeId: string
  readonly loaded: boolean
  /** 启动时恢复用户音源。 */
  restore(): Promise<void>
  activate(id: string): void
  /** 导入 .js 音源；返回错误信息（null = 成功）。 */
  addSource(name: string, code: string): string | null
  removeSource(id: string): void
}

function persistUserSources(sources: readonly OnlineSource[]): void {
  const userSources = sources
    .filter((s) => !s.builtin)
    .map(({ id, name, code }) => ({ id, name, code }))
  void saveOnlineSources(userSources)
}

export const useOnlineSourceStore = create<OnlineSourceStoreState>((set, get) => ({
  sources: BUILTIN_SOURCES,
  activeId: BUILTIN_SOURCES[0]?.id ?? 'audius',
  loaded: false,

  restore: async () => {
    if (get().loaded) return
    const persisted = await loadOnlineSources()
    set({
      sources: [...get().sources, ...persisted.map((s) => ({ ...s, builtin: false }))],
      loaded: true,
    })
  },

  activate: (id) => {
    if (get().sources.some((s) => s.id === id)) {
      set({ activeId: id })
    }
  },

  addSource: (name, code) => {
    if (name.trim() === '') return '音源名称不能为空'
    if (code.trim() === '') return '脚本内容不能为空'
    const id = `user-${Date.now().toString(36)}`
    const source: OnlineSource = { id, name: name.trim(), code, builtin: false }
    const sources = [...get().sources, source]
    set({ sources, activeId: id })
    persistUserSources(sources)
    return null
  },

  removeSource: (id) => {
    const sources = get().sources.filter((s) => s.id !== id)
    set({
      sources,
      activeId: get().activeId === id ? (sources[0]?.id ?? 'audius') : get().activeId,
    })
    persistUserSources(sources)
  },
}))
