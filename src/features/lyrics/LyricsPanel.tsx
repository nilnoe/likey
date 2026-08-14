import { useEffect, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { LyricsSync, type TokenProgress } from '../../core/lyrics/LyricsSync'
import { parseLrc, type LrcDocument } from '../../core/lyrics/lrcParser'
import { useLibraryStore } from '../../state/libraryStore'
import { useDownloadsStore } from '../../state/downloadsStore'
import { useLyricOverrideStore } from '../../state/lyricOverrideStore'
import { useQueueStore } from '../../state/queueStore'
import type { PlayerEngine } from '../player/usePlayerEngine'
import { loadLyricsOffset, saveLyricsOffset } from '../player/persistence'

interface LyricsState {
  readonly document: LrcDocument
  readonly sync: LyricsSync
}

const OFFSET_STEP_MS = 500

/**
 * 歌词面板（千千静听风卡拉OK 双行渐变）：
 * - 同步时钟直接读播放内核（rAF），不经 4Hz React 状态，逐字进度平滑
 * - 音乐库曲目自动加载同名 .lrc（资产协议）；拖放曲目可手动加载
 * - 偏移校准 ±0.5s/步，持久化留待 S5 皮肤/设置里程碑
 */
export function LyricsPanel({ engine }: { engine: PlayerEngine }) {
  const [state, setState] = useState<LyricsState | null>(null)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [progress, setProgress] = useState<TokenProgress | null>(null)
  const [userOffset, setUserOffset] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stateRef = useRef<LyricsState | null>(null)
  const userOffsetRef = useRef(0)
  const currentTrackIdRef = useRef<string | null>(null)
  const engineRef = useRef(engine)
  engineRef.current = engine

  const queueTracks = useQueueStore((s) => s.tracks)
  const queueIndex = useQueueStore((s) => s.index)
  const libraryTracks = useLibraryStore((s) => s.tracks)
  const lyricOverride = useLyricOverrideStore((s) => s.text)
  const lyricOverrideRef = useRef<string | null>(null)
  lyricOverrideRef.current = lyricOverride

  // 音源歌词覆盖（getLyric 注入）：优先于同名 .lrc 自动匹配
  useEffect(() => {
    if (lyricOverride !== null) {
      loadRaw(lyricOverride)
    }
  }, [lyricOverride])

  function loadRaw(raw: string): boolean {
    const document = parseLrc(raw)
    if (document.lines.length === 0) {
      setHint('未解析到歌词行（文件可能不是 LRC 格式）')
      return false
    }
    const sync = new LyricsSync(document)
    sync.setUserOffset(userOffsetRef.current)
    sync.onActiveLine(setActiveIndex)
    sync.onTokenProgress(setProgress)
    stateRef.current = { document, sync }
    setState({ document, sync })
    setHint(document.skippedLines > 0 ? `已跳过 ${document.skippedLines} 行非法歌词` : null)
    return true
  }

  // rAF 同步时钟：每帧用播放内核时钟驱动歌词引擎
  useEffect(() => {
    let raf = 0
    const loop = (): void => {
      raf = requestAnimationFrame(loop)
      const player = engineRef.current.player
      if (player.getStatus().kind !== 'idle') {
        stateRef.current?.sync.update(player.getPosition() * 1000)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [])

  // 队列切换：音乐库曲目自动尝试同名 .lrc
  useEffect(() => {
    const track = queueTracks[queueIndex]
    if (track === undefined) {
      currentTrackIdRef.current = null
      stateRef.current = null
      setState(null)
      setActiveIndex(null)
      setProgress(null)
      return
    }
    currentTrackIdRef.current = track.id
    // 恢复该曲目持久化的歌词偏移
    void loadLyricsOffset(track.id).then((offset) => {
      if (offset !== 0 && currentTrackIdRef.current === track.id) {
        userOffsetRef.current = offset
        setUserOffset(offset)
        stateRef.current?.sync.setUserOffset(offset)
      }
    })
    // 音源歌词覆盖优先：有注入歌词时跳过同名 .lrc 自动匹配
    if (lyricOverrideRef.current !== null) {
      return
    }
    const libraryTrack = libraryTracks.find((t) => t.id === track.id)
    if (libraryTrack === undefined) {
      setHint('拖放曲目无文件路径 — 可点击「加载歌词」手动选择 .lrc')
      return
    }
    // 下载档案歌词优先：曲库曲目命中下载记录且档案含歌词 → 直接用（旁路档案）
    const downloadRecord = useDownloadsStore
      .getState()
      .items.find((item) => item.path === libraryTrack.path)
    if (downloadRecord?.lyrics !== undefined && downloadRecord.lyrics.trim() !== '') {
      loadRaw(downloadRecord.lyrics)
      return
    }
    const dot = libraryTrack.path.lastIndexOf('.')
    const lrcPath = dot > 0 ? `${libraryTrack.path.slice(0, dot)}.lrc` : `${libraryTrack.path}.lrc`
    let cancelled = false
    void fetch(convertFileSrc(lrcPath))
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.text()
      })
      .then((text) => {
        if (!cancelled) loadRaw(text)
      })
      .catch(() => {
        if (!cancelled) {
          setHint(`未找到同名歌词（${libraryTrack.title}.lrc），可手动加载`)
        }
      })
    return () => {
      cancelled = true
    }
  }, [queueTracks, queueIndex, libraryTracks])

  // 当前行变化 → 自动滚动居中
  useEffect(() => {
    if (activeIndex === null || containerRef.current === null) return
    const element = containerRef.current.querySelector<HTMLElement>(`[data-line="${activeIndex}"]`)
    element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIndex])

  async function handleFile(files: FileList | null): Promise<void> {
    const file = files?.[0]
    if (file === undefined) return
    loadRaw(await file.text())
  }

  function adjustOffset(deltaMs: number): void {
    const next = userOffset + deltaMs
    userOffsetRef.current = next
    setUserOffset(next)
    stateRef.current?.sync.setUserOffset(next)
    const trackId = currentTrackIdRef.current
    if (trackId !== null) {
      void saveLyricsOffset(trackId, next)
    }
  }

  const document = state?.document ?? null

  return (
    <section className="lyrics-panel">
      <div className="lyrics-header">
        <h2>歌词</h2>
        <span className="lyrics-hint">{hint ?? (document === null ? '加载歌词后显示' : '')}</span>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          加载歌词
        </button>
        <button type="button" onClick={() => adjustOffset(-OFFSET_STEP_MS)} title="歌词提前 0.5 秒">
          提前 0.5s
        </button>
        <button type="button" onClick={() => adjustOffset(OFFSET_STEP_MS)} title="歌词延后 0.5 秒">
          延后 0.5s
        </button>
        {userOffset !== 0 && (
          <button type="button" onClick={() => adjustOffset(-userOffset)}>
            复位（{userOffset > 0 ? '+' : ''}
            {userOffset}ms）
          </button>
        )}
      </div>
      <div ref={containerRef} className="lyrics-list">
        {document !== null && document.lines.length > 0 ? (
          <ul className="lyrics-rows">
            {document.lines.map((line, i) => {
              const isActive = i === activeIndex
              const tokenCount = line.tokens.length
              const percent =
                isActive && progress !== null && tokenCount > 0
                  ? Math.min(
                      100,
                      Math.round(((progress.tokenIndex + progress.progress) / tokenCount) * 100),
                    )
                  : 0
              return (
                <li
                  key={`${line.start}-${i}`}
                  data-line={i}
                  className={isActive ? 'lyric-row active' : 'lyric-row'}
                >
                  <div className="lyric-line">
                    <span className="lyric-text">{line.text}</span>
                    {isActive && (
                      <span className="lyric-text lyric-overlay" style={{ width: `${percent}%` }}>
                        {line.text}
                      </span>
                    )}
                  </div>
                  {line.translation !== null && (
                    <div className="lyric-translation">{line.translation}</div>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="lyrics-empty">
            {document !== null ? '该 LRC 无有效歌词行' : '暂无歌词 — 音乐库曲目会自动匹配同名 .lrc'}
          </p>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".lrc,text/plain"
        className="hidden-input"
        onChange={(event) => void handleFile(event.target.files)}
      />
    </section>
  )
}
