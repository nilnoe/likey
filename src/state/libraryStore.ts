import { create } from 'zustand'
import { toLibraryTrack } from '../core/library/convert'
import type { LibraryScanState, LibraryTrack } from '../core/library/types'
import { scanDirectory } from '../features/library/tauriBridge'
import { loadLibraryDir, saveLibraryDir } from '../features/player/persistence'

/** 音乐库 UI 状态（zustand）：曲目列表 + 扫描进度。 */
interface LibraryStoreState {
  readonly tracks: readonly LibraryTrack[]
  readonly scanState: LibraryScanState
  readonly sourceDir: string | null
  scan(path: string): Promise<void>
  clear(): void
}

export const useLibraryStore = create<LibraryStoreState>((set) => ({
  tracks: [],
  scanState: { kind: 'idle' },
  sourceDir: null,

  scan: async (path) => {
    set({ scanState: { kind: 'scanning', done: 0, total: 0 }, sourceDir: path })
    void saveLibraryDir(path)
    try {
      const metas = await scanDirectory(path, true, (done, total) => {
        set({ scanState: { kind: 'scanning', done, total } })
      })
      set({
        tracks: metas.map(toLibraryTrack),
        scanState: {
          kind: 'done',
          added: metas.length,
          failed: 0,
        },
      })
    } catch (error: unknown) {
      set({
        scanState: {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  },

  clear: () => {
    void saveLibraryDir(null)
    set({ tracks: [], scanState: { kind: 'idle' }, sourceDir: null })
  },
}))

/** 启动时恢复上次扫描目录（无则 null）。 */
export async function restoreLibraryDir(): Promise<string | null> {
  return loadLibraryDir()
}
