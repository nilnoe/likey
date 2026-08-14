import { useEffect, useRef, useState } from 'react'
import {
  MUSIC_QUALITIES,
  type MusicQuality,
  type SourceSong,
} from '../../core/onlinesource/protocol'
import { useLibraryStore } from '../../state/libraryStore'
import { useLyricOverrideStore } from '../../state/lyricOverrideStore'
import { useOnlineSourceStore } from '../../state/onlineSourceStore'
import { useQueueStore } from '../../state/queueStore'
import { SourceRuntime, type SourceRuntimeStatus } from './SourceRuntime'

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

const STATUS_LABEL: Record<SourceRuntimeStatus, string> = {
  idle: '未加载',
  loading: '加载中…',
  ready: '就绪',
  error: '出错',
}

/**
 * 在线音源面板：管理 .js 音源（lx-music 兼容协议）、搜索、试听播放、歌词注入。
 * 脚本运行在 sandbox iframe，网络经主线程原生 HTTP 代理（免 CORS）。
 */
export function OnlineSourcePanel() {
  const sources = useOnlineSourceStore((s) => s.sources)
  const activeId = useOnlineSourceStore((s) => s.activeId)
  const activate = useOnlineSourceStore((s) => s.activate)
  const addSource = useOnlineSourceStore((s) => s.addSource)
  const removeSource = useOnlineSourceStore((s) => s.removeSource)
  const playTrack = useQueueStore((s) => s.playTrack)
  const libraryTracks = useLibraryStore((s) => s.tracks)
  const setLyricOverride = useLyricOverrideStore((s) => s.set)
  const lyricOverride = useLyricOverrideStore((s) => s.text)

  const runtimeRef = useRef<SourceRuntime | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<SourceRuntimeStatus>('idle')
  const [statusError, setStatusError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [quality, setQuality] = useState<MusicQuality>('128k')
  const [results, setResults] = useState<readonly SourceSong[]>([])
  const [searching, setSearching] = useState(false)
  const [busySong, setBusySong] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  function ensureRuntime(): SourceRuntime {
    if (runtimeRef.current === null) {
      runtimeRef.current = new SourceRuntime()
    }
    return runtimeRef.current
  }

  // 激活音源变化 → 重载脚本
  useEffect(() => {
    const source = sources.find((s) => s.id === activeId)
    if (source === undefined) return
    const runtime = ensureRuntime()
    let cancelled = false
    void (async () => {
      let code = source.code
      if (source.builtin && source.assetPath !== undefined) {
        try {
          const response = await fetch(source.assetPath)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          code = await response.text()
        } catch (error) {
          if (!cancelled) {
            setStatusError(error instanceof Error ? error.message : String(error))
          }
          return
        }
      }
      try {
        await runtime.load(code)
      } catch (error) {
        if (!cancelled) {
          setStatusError(error instanceof Error ? error.message : String(error))
        }
      }
    })()
    const unsubscribe = runtime.onStatus((next, error) => {
      setStatus(next)
      setStatusError(error ?? null)
      if (next !== 'ready') setResults([])
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [activeId, sources])

  // 内置示例源：注入本地曲库配置（曲库变化即时更新）
  useEffect(() => {
    const source = sources.find((s) => s.id === activeId)
    const runtime = runtimeRef.current
    if (runtime === null || source?.builtin !== true) return
    if (runtime.getStatus() !== 'ready') return
    runtime.sendConfig(
      libraryTracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        fileUrl: t.fileUrl,
      })),
    )
  }, [libraryTracks, sources, activeId])

  async function handleSearch(): Promise<void> {
    const runtime = runtimeRef.current
    if (runtime === null || runtime.getStatus() !== 'ready') {
      setHint('音源未就绪')
      return
    }
    setSearching(true)
    setHint(null)
    try {
      setResults(await runtime.search(keyword, 1, 50))
    } catch (error) {
      setResults([])
      setHint(error instanceof Error ? error.message : String(error))
    } finally {
      setSearching(false)
    }
  }

  async function handlePlay(song: SourceSong): Promise<void> {
    const runtime = runtimeRef.current
    if (runtime === null) return
    setBusySong(song.songmid)
    setHint(null)
    try {
      const url = await runtime.getMusicUrl(song.songmid, quality)
      if (url === null) {
        setHint('音源未返回可播放地址')
        return
      }
      await playTrack({
        id: `os-${activeId}-${song.songmid}-${quality}`,
        name: `${song.name} - ${song.singer}`,
        source: { kind: 'url', url },
      })
    } catch (error) {
      setHint(error instanceof Error ? error.message : String(error))
    } finally {
      setBusySong(null)
    }
  }

  async function handleLyric(song: SourceSong): Promise<void> {
    const runtime = runtimeRef.current
    if (runtime === null) return
    setHint(null)
    try {
      const lyric = await runtime.getLyric(song.songmid)
      if (lyric === null || lyric.trim() === '') {
        setHint('音源未提供歌词')
        return
      }
      setLyricOverride(lyric)
      setHint('歌词已加载到歌词面板（可通过「清除歌词」还原自动匹配）')
    } catch (error) {
      setHint(error instanceof Error ? error.message : String(error))
    }
  }

  async function handleImport(files: FileList | null): Promise<void> {
    const file = files?.[0]
    if (file === undefined) return
    const name = file.name.replace(/\.js$/i, '')
    const error = addSource(name, await file.text())
    setHint(error ?? `已导入音源「${name}」`)
  }

  const activeSource = sources.find((s) => s.id === activeId)

  return (
    <section className="online-panel">
      <div className="online-header">
        <h2>在线音源</h2>
        <select value={activeId} onChange={(event) => activate(event.target.value)}>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
        <span
          className={status === 'error' ? 'online-status online-status-error' : 'online-status'}
        >
          {STATUS_LABEL[status]}
        </span>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          导入 .js 音源
        </button>
        {activeSource !== undefined && !activeSource.builtin && (
          <button type="button" onClick={() => removeSource(activeSource.id)}>
            删除当前音源
          </button>
        )}
      </div>
      {statusError !== null && <div className="online-error">{statusError}</div>}
      <div className="online-search">
        <input
          type="text"
          value={keyword}
          placeholder="搜索歌曲 / 歌手"
          onChange={(event) => setKeyword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleSearch()
          }}
        />
        <select
          value={quality}
          onChange={(event) => setQuality(event.target.value as MusicQuality)}
          title="音质"
        >
          {MUSIC_QUALITIES.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={searching || status !== 'ready'}
        >
          {searching ? '搜索中…' : '搜索'}
        </button>
      </div>
      {hint !== null && <div className="online-hint">{hint}</div>}
      {lyricOverride !== null && (
        <div className="online-hint">
          已注入音源歌词
          <button type="button" onClick={() => setLyricOverride(null)}>
            清除歌词
          </button>
        </div>
      )}
      {results.length > 0 ? (
        <ul className="online-results">
          {results.map((song) => (
            <li key={`${song.source}-${song.songmid}`} className="online-row">
              <span className="online-name">{song.name}</span>
              <span className="online-singer">{song.singer}</span>
              <span className="online-album">{song.album}</span>
              {song.interval > 0 && (
                <span className="online-duration">{formatDuration(song.interval)}</span>
              )}
              <button
                type="button"
                onClick={() => void handlePlay(song)}
                disabled={busySong === song.songmid}
              >
                {busySong === song.songmid ? '获取中…' : '▶ 播放'}
              </button>
              <button type="button" onClick={() => void handleLyric(song)}>
                歌词
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="online-empty">
          输入关键词搜索（内置示例源可搜索本地音乐库；导入 lx-music 兼容音源可搜索在线曲库）
        </p>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".js,text/javascript"
        className="hidden-input"
        onChange={(event) => void handleImport(event.target.files)}
      />
    </section>
  )
}
