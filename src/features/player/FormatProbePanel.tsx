import { useState } from 'react'
import { probeFormat, type AudioFormat, type ProbeResult } from '../../core/player/probe'
import type { WebAudioBackend } from '../../core/player/WebAudioBackend'

interface ProbeFormatEntry {
  readonly format: AudioFormat
  readonly label: string
  readonly url: string
}

const PROBE_FORMATS: readonly ProbeFormatEntry[] = [
  { format: 'mp3', label: 'MP3', url: '/fixtures/tone.mp3' },
  { format: 'flac', label: 'FLAC', url: '/fixtures/tone.flac' },
  { format: 'wav', label: 'WAV', url: '/fixtures/tone.wav' },
]

/**
 * 格式兼容性探测面板（S0 Spike 核心验证）：
 * 用 440Hz 测试音样本验证当前 WebView 的 decodeAudioData 对各格式的支持情况。
 */
export function FormatProbePanel({ backend }: { backend: WebAudioBackend }) {
  const [results, setResults] = useState<readonly ProbeResult[]>([])
  const [running, setRunning] = useState(false)

  async function run(): Promise<void> {
    setRunning(true)
    const next: ProbeResult[] = []
    for (const entry of PROBE_FORMATS) {
      next.push(await probeFormat(entry.format, entry.url, backend))
    }
    setResults(next)
    setRunning(false)
  }

  return (
    <section className="probe-panel">
      <div className="probe-header">
        <h2>格式探测（Spike）</h2>
        <button type="button" onClick={() => void run()} disabled={running}>
          {running ? '探测中…' : '运行探测'}
        </button>
      </div>
      <div className="probe-list">
        {PROBE_FORMATS.map((entry) => {
          const result = results.find((r) => r.format === entry.format)
          return (
            <span key={entry.format} className="probe-item">
              <span
                className={
                  result === undefined ? 'probe-wait' : result.ok ? 'probe-ok' : 'probe-fail'
                }
              >
                {result === undefined ? '○' : result.ok ? '✅' : '❌'}
              </span>
              <span>{entry.label}</span>
              {result !== undefined && !result.ok && (
                <span className="probe-error" title={result.error}>
                  {result.error}
                </span>
              )}
            </span>
          )
        })}
      </div>
      <p className="probe-hint">
        FLAC 结果为 ❌ 时，MVP 需引入 WASM 解码器兜底（见 docs/DESIGN.md §14）。
      </p>
    </section>
  )
}
