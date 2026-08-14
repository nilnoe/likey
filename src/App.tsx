import { useRef, useState } from 'react'
import './App.css'
import { FormatProbePanel } from './features/player/FormatProbePanel'
import { usePlayerEngine } from './features/player/usePlayerEngine'
import { VisualizerCanvas } from './features/visualizer/VisualizerCanvas'

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

  const duration = engine.player.getDuration()
  const canToggle = status.kind === 'playing' || status.kind === 'ready'

  async function handleFiles(files: FileList | null): Promise<void> {
    const file = files?.[0]
    if (file === undefined) return
    setBusy(true)
    try {
      await controls.loadFile(file)
      await controls.toggle()
    } finally {
      setBusy(false)
    }
  }

  let statusText: string
  switch (status.kind) {
    case 'idle':
      statusText = '未加载曲目 — 点击「打开音频」选择本地 mp3 / flac / wav'
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
        <span className="app-subtitle">千千静听风律动播放器 · S0 Spike</span>
      </header>
      <main className="app-main">
        <section className="visualizer-panel">
          <VisualizerCanvas engine={engine} />
        </section>
        <section className="transport">
          <div className="transport-row">
            <button type="button" onClick={() => fileInputRef.current?.click()} disabled={busy}>
              打开音频
            </button>
            <button
              type="button"
              onClick={() => void controls.toggle()}
              disabled={!canToggle || busy}
            >
              {status.kind === 'playing' ? '暂停' : '播放'}
            </button>
            <button type="button" onClick={controls.stop} disabled={busy}>
              停止
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
        <FormatProbePanel backend={engine.backend} />
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.flac,.wav"
          className="hidden-input"
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </main>
    </div>
  )
}
