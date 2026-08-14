import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { LibraryTrack } from '../../core/library/types'
import { toPlaylistTrack } from '../../core/library/convert'
import { restoreLibraryDir, useLibraryStore } from '../../state/libraryStore'
import { useQueueStore } from '../../state/queueStore'
import { pickDirectory, readCoverBytes } from './tauriBridge'

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/** 封面 Blob URL 缓存（path → url；null = 无封面，避免重复 IPC）。 */
const coverCache = new Map<string, string | null>()

function CoverThumb({ track }: { track: LibraryTrack }) {
  const [url, setUrl] = useState<string | null>(() => coverCache.get(track.path) ?? null)

  useEffect(() => {
    if (!track.hasCover) return
    const cached = coverCache.get(track.path)
    if (cached !== undefined) {
      setUrl(cached)
      return
    }
    let cancelled = false
    void readCoverBytes(track.path)
      .then((bytes) => {
        if (cancelled) return
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
        coverCache.set(track.path, blobUrl)
        setUrl(blobUrl)
      })
      .catch(() => {
        coverCache.set(track.path, null)
      })
    return () => {
      cancelled = true
    }
  }, [track])

  if (url === null) {
    return <span className="library-cover library-cover-empty">♪</span>
  }
  return <img className="library-cover" src={url} alt="" loading="lazy" />
}

/**
 * 音乐库面板：选择目录 → Rust 扫描（进度条）→ 虚拟列表（万首不卡）。
 * 点击行播放；封面懒加载（内嵌封面经 IPC 转 Blob URL，带缓存）。
 */
export function LibraryPanel() {
  const tracks = useLibraryStore((s) => s.tracks)
  const scanState = useLibraryStore((s) => s.scanState)
  const sourceDir = useLibraryStore((s) => s.sourceDir)
  const scan = useLibraryStore((s) => s.scan)
  const clear = useLibraryStore((s) => s.clear)
  const playLibraryTrack = useQueueStore((s) => s.playLibraryTrack)
  const listRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const autoRestoredRef = useRef(false)

  // 启动恢复：有持久化的音乐库目录且尚未扫描 → 自动重扫
  useEffect(() => {
    if (autoRestoredRef.current) return
    autoRestoredRef.current = true
    const state = useLibraryStore.getState()
    if (state.tracks.length > 0 || state.scanState.kind !== 'idle') return
    void restoreLibraryDir().then((dir) => {
      if (dir !== null) {
        void useLibraryStore.getState().scan(dir)
      }
    })
  }, [])

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 44,
    overscan: 8,
  })

  async function handlePick(): Promise<void> {
    const dir = await pickDirectory()
    if (dir === null) return
    setBusy(true)
    try {
      await scan(dir)
    } finally {
      setBusy(false)
    }
  }

  let statusText: string
  switch (scanState.kind) {
    case 'idle':
      statusText = '尚未扫描'
      break
    case 'scanning':
      statusText =
        scanState.total > 0
          ? `扫描中 ${scanState.done}/${scanState.total}`
          : `扫描中 ${scanState.done} 首…`
      break
    case 'done':
      statusText = `已入库 ${scanState.added} 首`
      break
    case 'error':
      statusText = `扫描失败：${scanState.message}`
      break
  }

  return (
    <section className="library-panel">
      <div className="library-header">
        <h2>音乐库</h2>
        <span className="library-dir" title={sourceDir ?? undefined}>
          {sourceDir ?? '未选择目录'}
        </span>
        <span className="library-status">{statusText}</span>
        <button type="button" onClick={() => void handlePick()} disabled={busy}>
          {busy ? '扫描中…' : '选择目录扫描'}
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={tracks.length === 0 && scanState.kind === 'idle'}
        >
          清空
        </button>
      </div>
      {scanState.kind === 'scanning' && (
        <div className="library-progress">
          <div
            className="library-progress-bar"
            style={{
              width: `${scanState.total > 0 ? Math.round((scanState.done / scanState.total) * 100) : 0}%`,
            }}
          />
        </div>
      )}
      {tracks.length === 0 ? (
        <p className="library-empty">选择音乐目录开始扫描（mp3 / flac / wav）</p>
      ) : (
        <div ref={listRef} className="library-list">
          <div className="library-list-inner" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const track = tracks[virtualRow.index]
              if (track === undefined) return null
              return (
                <div
                  key={track.id}
                  className="library-row"
                  style={{
                    transform: `translateY(${virtualRow.start}px)`,
                    height: `${virtualRow.size}px`,
                  }}
                  onClick={() => void playLibraryTrack(toPlaylistTrack(track))}
                >
                  <CoverThumb track={track} />
                  <span className="library-title">{track.title}</span>
                  <span className="library-artist">{track.artist}</span>
                  <span className="library-album">{track.album}</span>
                  <span className="library-duration">{formatDuration(track.duration)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
