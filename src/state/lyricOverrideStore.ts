import { create } from 'zustand'

/** 在线音源歌词覆盖：getLyric 结果注入歌词面板（优先于同名 .lrc 自动匹配）。 */
interface LyricOverrideState {
  readonly text: string | null
  set(text: string | null): void
}

export const useLyricOverrideStore = create<LyricOverrideState>((set) => ({
  text: null,
  set: (text) => set({ text }),
}))
