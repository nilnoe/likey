import { useRef } from 'react'
import { useQueueStore } from '../../state/queueStore'
import { filterAudioFiles } from './audioFiles'

/**
 * 播放列表面板：曲目列表（点击播放/移除）、添加文件、清空。
 * 状态全部来自 queueStore；当前播放指示由 playing 属性提供。
 */
export function PlaylistPanel({ playing }: { playing: boolean }) {
  const tracks = useQueueStore((s) => s.tracks)
  const index = useQueueStore((s) => s.index)
  const playIndex = useQueueStore((s) => s.playIndex)
  const removeAt = useQueueStore((s) => s.removeAt)
  const clear = useQueueStore((s) => s.clear)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null): Promise<void> {
    const list = filterAudioFiles(Array.from(files ?? []))
    if (list.length > 0) {
      await useQueueStore.getState().addFiles(list, true)
    }
  }

  return (
    <section className="playlist-panel">
      <div className="playlist-header">
        <h2>播放列表（{tracks.length}）</h2>
        <button type="button" onClick={() => inputRef.current?.click()}>
          添加音频
        </button>
        <button type="button" onClick={clear} disabled={tracks.length === 0}>
          清空
        </button>
      </div>
      {tracks.length === 0 ? (
        <p className="playlist-empty">列表为空 — 点击「添加音频」或把音乐文件拖进窗口</p>
      ) : (
        <ul className="playlist-list">
          {tracks.map((track, i) => (
            <li
              key={track.id}
              className={i === index ? 'playlist-item active' : 'playlist-item'}
              onClick={() => void playIndex(i)}
            >
              <span className="playlist-number">{i + 1}</span>
              <span className="playlist-name">{track.name}</span>
              {i === index && playing && <span className="playlist-playing">▶</span>}
              <button
                type="button"
                className="playlist-remove"
                aria-label={`移除 ${track.name}`}
                onClick={(event) => {
                  event.stopPropagation()
                  removeAt(i)
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.mp3,.flac,.wav,.m4a,.aac"
        multiple
        className="hidden-input"
        onChange={(event) => void handleFiles(event.target.files)}
      />
    </section>
  )
}
