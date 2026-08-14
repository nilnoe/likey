import { create } from 'zustand'
import { QueueController, type QueuePlayer } from '../core/player/QueueController'
import type { PlaylistTrack, RepeatMode } from '../core/player/Queue'

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
  addFiles(files: readonly File[], playFirst?: boolean): Promise<void>
  playIndex(index: number): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
  removeAt(index: number): void
  clear(): void
  setRepeat(mode: RepeatMode): void
  toggleShuffle(): void
}

let controller: QueueController | null = null

export const useQueueStore = create<QueueStoreState>((set) => ({
  tracks: [],
  index: -1,
  repeat: 'off',
  shuffle: false,

  bind: (player) => {
    if (controller !== null) return
    controller = new QueueController(player)
    controller.onQueueChange(() => {
      const snapshot = controller?.getSnapshot()
      set({ tracks: [...(snapshot?.tracks ?? [])] })
    })
    controller.onIndexChange((index) => set({ index }))
    controller.onRepeatChange((repeat) => set({ repeat }))
    controller.onShuffleChange((shuffle) => set({ shuffle }))
  },

  addFiles: async (files, playFirst = false) => {
    await controller?.addFiles(files, playFirst)
  },

  playIndex: async (index) => {
    await controller?.playIndex(index)
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
