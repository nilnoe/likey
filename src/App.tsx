import { useEffect, useRef, useState } from 'react'
import './App.css'
import { LibraryPanel } from './features/library/LibraryPanel'
import { LyricsPanel } from './features/lyrics/LyricsPanel'
import { OnlineSourcePanel } from './features/onlinesource/OnlineSourcePanel'
import { FormatProbePanel } from './features/player/FormatProbePanel'
import { PlaylistPanel } from './features/player/PlaylistPanel'
import { filterAudioFiles } from './features/player/audioFiles'
import { usePlayerEngine } from './features/player/usePlayerEngine'
import { SkinSwitcher } from './features/skins/SkinSwitcher'
import { VisualizerCanvas } from './features/visualizer/VisualizerCanvas'
import { useDownloadsStore } from './state/downloadsStore'
import { useOnlineSourceStore } from './state/onlineSourceStore'
import { useQueueStore } from './state/queueStore'
import { useSkinStore } from './state/skinStore'

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export default function App() {
  const { engine, status, position, controls } = usePlayerEngine()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const repeat = useQueueStore((s) => s.repeat)
  const shuffle = useQueueStore((s) => s.shuffle)
  const next = useQueueStore((s) => s.next)
  const prev = useQueueStore((s) => s.prev)
  const setRepeat = useQueueStore((s) => s.setRepeat)
  const toggleShuffle = useQueueStore((s) => s.toggleShuffle)

  const skins = useSkinStore((s) => s.skins)
  const activeSkinId = useSkinStore((s) => s.activeId)
  const activeSkin = skins.find((skin) => skin.id === activeSkinId)

  // 皮肤 → CSS 变量（全应用即时生效）
  useEffect(() => {
    if (activeSkin === undefined) return
    const root = document.documentElement.style
    root.setProperty('--bg', activeSkin.colors.appBg)
    root.setProperty('--panel', activeSkin.colors.panelBg)
    root.setProperty('--panel-border', activeSkin.colors.panelBorder)
    root.setProperty('--text', activeSkin.colors.textPrimary)
    root.setProperty('--muted', activeSkin.colors.textSecondary)
    root.setProperty('--accent', activeSkin.colors.accent)
    root.setProperty('--lyric-active', activeSkin.colors.lyricActive)
    root.setProperty('--lyric-progress', activeSkin.colors.lyricProgress)
    root.setProperty('--lyric-inactive', activeSkin.colors.lyricInactive)
    root.setProperty('--lyric-font-size', `${activeSkin.lyrics.fontSize}px`)
    root.setProperty('color-scheme', activeSkin.colorScheme)
  }, [activeSkin])

  // 启动时恢复用户音源脚本与下载列表
  useEffect(() => {
    void useOnlineSourceStore.getState().restore()
    void useDownloadsStore.getState().restore()
  }, [])

  const duration = engine.player.getDuration()
  const canToggle = status.kind === 'playing' || status.kind === 'ready'

  // 窗口级拖放：音频文件拖入即加入队列（队列为空时自动开始播放）
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => {
      event.preventDefault()
    }
    const onDrop = (event: DragEvent): void => {
      event.preventDefault()
      const files = filterAudioFiles(Array.from(event.dataTransfer?.files ?? []))
      if (files.length > 0) {
        void useQueueStore.getState().addFiles(files, true)
      }
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  async function handleFiles(files: FileList | null): Promise<void> {
    const list = filterAudioFiles(Array.from(files ?? []))
    if (list.length === 0) return
    setBusy(true)
    try {
      await useQueueStore.getState().addFiles(list, true)
    } finally {
      setBusy(false)
    }
  }

  const repeatLabel = repeat === 'off' ? '循环: 关' : repeat === 'all' ? '循环: 列表' : '循环: 单曲'
  const cycleRepeat = (): void => {
    setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')
  }

  let statusText: string
  switch (status.kind) {
    case 'idle':
      statusText = '未加载曲目 — 添加音频或把音乐文件拖进窗口'
      break
    case 'loading':
      statusText = `解码中：${status.trackName}`
      break
    case 'ready':
      statusText = `已就绪（暂停）：${status.trackName}`
      break
    case 'playing':
      statusText = `播放中：${status.trackName}`
      break
    case 'error':
      statusText = `解码失败：${status.message}`
      break
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Likey</h1>
        <span className="app-subtitle">千千静听风律动播放器 · S5 皮肤系统</span>
        <div className="app-header-right">
          <SkinSwitcher />
        </div>
      </header>
      <main className="app-main">
        <section className="visualizer-panel">
          <VisualizerCanvas engine={engine} />
        </section>
        <section className="transport">
          <div className="transport-row">
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
              添加音频
            </button>
            <button type="button" onClick={() => void prev()}>
              ⏮ 上一曲
            </button>
            <button
              type="button"
              onClick={() => void controls.toggle()}
              disabled={!canToggle || busy}
            >
              {status.kind === 'playing' ? '暂停' : '播放'}
            </button>
            <button type="button" onClick={() => void next()}>
              下一曲 ⏭
            </button>
            <button
              type="button"
              onClick={cycleRepeat}
              className={repeat !== 'off' ? 'button-active' : undefined}
            >
              {repeatLabel}
            </button>
            <button
              type="button"
              onClick={toggleShuffle}
              className={shuffle ? 'button-active' : undefined}
            >
              随机: {shuffle ? '开' : '关'}
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(duration, 1)}
            step={0.1}
            value={Math.min(position, duration)}
            onChange={(event) => controls.seek(Number(event.target.value))}
            aria-label="播放进度"
          />
          <div className="transport-row">
            <span className="time-label">
              {formatTime(position)} / {formatTime(duration)}
            </span>
            <label className="volume-label">
              音量
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                defaultValue={1}
                onChange={(event) => controls.setVolume(Number(event.target.value))}
              />
            </label>
          </div>
          <div className="status-line">{statusText}</div>
        </section>
        <div className="bottom-panels">
          <OnlineSourcePanel />
          <LyricsPanel engine={engine} />
          <LibraryPanel />
          <PlaylistPanel playing={status.kind === 'playing'} />
          <FormatProbePanel backend={engine.backend} />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.flac,.wav"
          multiple
          className="hidden-input"
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </main>
    </div>
  )
}
