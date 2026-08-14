import { create } from 'zustand'
import { QueueController, type QueuePlayer } from '../core/player/QueueController'
import {
  defaultReadSource,
  type PlaylistTrack,
  type RepeatMode,
  type TrackSource,
} from '../core/player/Queue'
import { saveQueue, type RestoredQueue } from '../features/player/persistence'

/** 远端 http(s) 曲目走原生插件 HTTP（免 CORS），其余（资产协议/文件）走默认实现。 */
async function readSourceNativeHttp(source: TrackSource): Promise<ArrayBuffer> {
  if (source.kind === 'url' && /^https?:\/\//i.test(source.url)) {
    try {
      const { fetch } = await import('@tauri-apps/plugin-http')
      const response = await fetch(source.url)
      if (!response.ok) {
        throw new Error(`音频读取失败: HTTP ${response.status}`)
      }
      return response.arrayBuffer()
    } catch (error) {
      // 插件不可用（纯 Web 调试）→ 回退默认（受 CORS 限制）
      if (error instanceof Error && error.message.startsWith('音频读取失败')) throw error
    }
  }
  return defaultReadSource(source)
}

/**
 * 播放队列 UI 状态（zustand）。
 * QueueController 是唯一事实来源，本 store 仅镜像快照供 React 渲染；
 * 高频数据（频谱帧/节拍）不经 store，低频队列状态才进 store（DESIGN §12）。
 */
interface QueueStoreState {
  readonly tracks: readonly PlaylistTrack[]
  readonly index: number
  readonly repeat: RepeatMode
  readonly shuffle: boolean
  bind(player: QueuePlayer): void
  /** 会话恢复（持久化快照；不自动播放）。 */
  restore(snapshot: RestoredQueue): void
  addFiles(files: readonly File[], playFirst?: boolean): Promise<void>
  addTracks(tracks: readonly PlaylistTrack[], playFirst?: boolean): Promise<void>
  playIndex(index: number): Promise<void>
  /** 播放任意来源曲目（音源/音乐库）：已在队列则切过去，否则追加后播放。 */
  playTrack(track: PlaylistTrack): Promise<void>
  /** 播放音乐库曲目：已在队列则直接切过去，否则追加后播放。 */
  playLibraryTrack(track: PlaylistTrack): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
  removeAt(index: number): void
  clear(): void
  setRepeat(mode: RepeatMode): void
  toggleShuffle(): void
}

let controller: QueueController | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** 队列变化 → 防抖持久化（500ms 合并连续变更）。 */
function scheduleSave(): void {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (controller !== null) {
      void saveQueue(controller.getSnapshot())
    }
  }, 500)
}

export const useQueueStore = create<QueueStoreState>((set) => ({
  tracks: [],
  index: -1,
  repeat: 'off',
  shuffle: false,

  bind: (player) => {
    if (controller !== null) return
    controller = new QueueController(player, { readSource: readSourceNativeHttp })
    controller.onQueueChange(() => {
      const snapshot = controller?.getSnapshot()
      set({ tracks: [...(snapshot?.tracks ?? [])] })
      scheduleSave()
    })
    controller.onIndexChange((index) => {
      set({ index })
      scheduleSave()
    })
    controller.onRepeatChange((repeat) => {
      set({ repeat })
      scheduleSave()
    })
    controller.onShuffleChange((shuffle) => {
      set({ shuffle })
      scheduleSave()
    })
  },

  restore: (snapshot) => {
    controller?.restore(snapshot)
  },

  addFiles: async (files, playFirst = false) => {
    await controller?.addFiles(files, playFirst)
  },

  addTracks: async (tracks, playFirst = false) => {
    await controller?.addTracks(tracks, playFirst)
  },

  playIndex: async (index) => {
    await controller?.playIndex(index)
  },

  playTrack: async (track) => {
    if (controller === null) return
    const existing = controller.getSnapshot().tracks.findIndex((t) => t.id === track.id)
    if (existing >= 0) {
      await controller.playIndex(existing)
      return
    }
    const before = controller.getSnapshot().tracks.length
    await controller.addTracks([track])
    await controller.playIndex(before)
  },

  playLibraryTrack: async (track) => {
    await useQueueStore.getState().playTrack(track)
  },

  next: async () => {
    await controller?.next()
  },

  prev: async () => {
    await controller?.prev()
  },

  removeAt: (index) => {
    controller?.removeAt(index)
  },

  clear: () => {
    controller?.clear()
  },

  setRepeat: (mode) => {
    controller?.setRepeat(mode)
  },

  toggleShuffle: () => {
    controller?.toggleShuffle()
  },
}))
