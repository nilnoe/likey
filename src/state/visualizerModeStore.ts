import { create } from 'zustand'

export type VisualizerMode = 'bars' | 'liquid' | 'chunky' | 'green' | 'bands'

interface VisualizerModeState {
  readonly mode: VisualizerMode
  setMode(mode: VisualizerMode): void
}

/** 律动视觉形态（运行时偏好，独立于皮肤，可随时切换对比）。 */
export const useVisualizerModeStore = create<VisualizerModeState>((set) => ({
  mode: 'liquid',
  setMode: (mode) => set({ mode }),
}))
