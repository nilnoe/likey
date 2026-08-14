import type { DecodedBuffer } from './PlayerBackend'

export type AudioFormat = 'mp3' | 'flac' | 'wav' | 'm4a' | 'aac'

export interface ProbeResult {
  readonly format: AudioFormat
  readonly ok: boolean
  readonly duration?: number
  readonly error?: string
}

/** 探测用最小解码接口（WebAudioBackend 天然满足）。 */
export interface ProbeDecoder {
  decode(data: ArrayBuffer): Promise<DecodedBuffer>
}

export function describeDecodeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotSupportedError') {
    return '当前 WebView 不支持该格式解码（需 WASM 兜底）'
  }
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * 格式兼容性探测：下载样本 → 原生解码 → 报告成败。
 * 用于 Spike 验证 WebView 对 mp3/flac/wav 的 decodeAudioData 支持情况。
 */
export async function probeFormat(
  format: AudioFormat,
  url: string,
  decoder: ProbeDecoder,
): Promise<ProbeResult> {
  try {
    const response = await fetch(url)
    if (!response.ok) return { format, ok: false, error: `HTTP ${response.status}` }
    const bytes = await response.arrayBuffer()
    const decoded = await decoder.decode(bytes)
    return { format, ok: true, duration: decoded.duration }
  } catch (error: unknown) {
    return { format, ok: false, error: describeDecodeError(error) }
  }
}
