import { useEffect, useRef, useState } from 'react'
import { BeatDetector } from '../../core/analysis/BeatDetector'
import { SpectrumExtractor } from '../../core/analysis/SpectrumExtractor'
import { PlayerCore, type PlayerStatus } from '../../core/player/PlayerCore'
import { WebAudioBackend } from '../../core/player/WebAudioBackend'
import { useQueueStore } from '../../state/queueStore'
import { loadQueue } from './persistence'

/** 播放引擎：一次会话内稳定的 core 实例集合。 */
export interface PlayerEngine {
  readonly player: PlayerCore
  readonly backend: WebAudioBackend
  readonly extractor: SpectrumExtractor
  readonly detector: BeatDetector
}

export interface PlayerControls {
  toggle(): Promise<void>
  stop(): void
  seek(seconds: number): void
  setVolume(volume: number): void
}

function createEngine(): PlayerEngine {
  const backend = new WebAudioBackend()
  const player = new PlayerCore(backend)
  const extractor = new SpectrumExtractor(backend.analyser, {
    sampleRate: backend.context.sampleRate,
    minFreq: 20,
    maxFreq: 16000,
    barCount: 48,
  })
  const detector = new BeatDetector()
  return { player, backend, extractor, detector }
}

/**
 * 播放引擎 hook：core 实例经 ref 保持稳定；
 * 高频数据（频谱/节拍）不经 React 状态，低频 UI 状态（status/position）4Hz 刷新。
 * 首次挂载时把 PlayerCore 绑定到队列 store（模块级单例，StrictMode 安全）。
 */
export function usePlayerEngine(): {
  engine: PlayerEngine
  status: PlayerStatus
  position: number
  controls: PlayerControls
} {
  const engineRef = useRef<PlayerEngine | null>(null)
  if (engineRef.current === null) {
    engineRef.current = createEngine()
  }
  const engine = engineRef.current
  const [status, setStatus] = useState<PlayerStatus>(engine.player.getStatus())
  const [position, setPosition] = useState(0)

  useEffect(() => {
    useQueueStore.getState().bind(engine.player)
    // 会话恢复：持久化队列快照（不自动播放，等待用户手势）
    void loadQueue().then((persisted) => {
      if (persisted !== null) {
        useQueueStore.getState().restore(persisted)
      }
    })
    const unsubscribe = engine.player.onStatusChange(setStatus)
    const interval = window.setInterval(() => {
      setPosition(engine.player.getPosition())
    }, 250)
    return () => {
      unsubscribe()
      window.clearInterval(interval)
    }
  }, [engine])

  const controls: PlayerControls = {
    toggle: async (): Promise<void> => {
      const current = engine.player.getStatus()
      if (current.kind === 'playing') {
        engine.player.pause()
      } else if (current.kind === 'ready') {
        await engine.player.play()
      }
    },
    stop: (): void => {
      engine.player.stop()
    },
    seek: (seconds: number): void => {
      engine.player.seek(seconds)
    },
    setVolume: (volume: number): void => {
      engine.player.setVolume(volume)
    },
  }

  return { engine, status, position, controls }
}
