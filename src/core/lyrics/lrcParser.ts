export interface LyricToken {
  /** ms */
  readonly time: number
  readonly text: string
}

export interface LyricLine {
  /** 行起始时间 ms */
  readonly start: number
  /** 长度 1 = 整行；>1 = 逐字（多时间标签） */
  readonly tokens: readonly LyricToken[]
  /** 整行文本（token 拼接） */
  readonly text: string
  /** 同时间的翻译行（无则 null） */
  readonly translation: string | null
}

export interface LrcDocument {
  /** 按时间升序 */
  readonly lines: readonly LyricLine[]
  readonly metadata: Readonly<Record<string, string>>
  /** 文件内 [offset:±ms] */
  readonly offsetMs: number
  /** 跳过的非法行数 */
  readonly skippedLines: number
}

const TIME_TAG = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g
const META_TAG = /^\[(ti|ar|al|by|offset|re|ve):(.*)\]$/i

function parseTimeTag(minutes: string, seconds: string): number {
  return Number(minutes) * 60_000 + Number(seconds) * 1000
}

/**
 * 多时间标签 → 逐字 token：文本按相邻时间间隔的时长比例切分。
 * 单时间标签 → 整行单 token。
 */
export function splitIntoTokens(text: string, times: readonly number[]): LyricToken[] {
  if (times.length === 0) return []
  if (times.length === 1) {
    return [{ time: times[0] ?? 0, text }]
  }
  const chars = Array.from(text.trim())
  // 各段时长 = 相邻时间戳间隔；末段无后继 → 取平均间隔（保底 1ms）
  const gaps: number[] = []
  for (let i = 0; i + 1 < times.length; i++) {
    gaps.push((times[i + 1] ?? 0) - (times[i] ?? 0))
  }
  const avgGap = gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : 0
  const durations = [...gaps, avgGap > 0 ? avgGap : 1]
  const totalDuration = durations.reduce((sum, d) => sum + d, 0)
  const tokens: LyricToken[] = []
  let cursor = 0
  for (let i = 0; i < times.length; i++) {
    const remaining = chars.length - cursor
    if (remaining <= 0) {
      tokens.push({ time: times[i] ?? 0, text: '' })
      continue
    }
    const duration = durations[i] ?? 0
    const share = totalDuration > 0 ? duration / totalDuration : 1 / times.length
    let length = i === times.length - 1 ? remaining : Math.max(1, Math.round(chars.length * share))
    length = Math.min(length, remaining)
    tokens.push({ time: times[i] ?? 0, text: chars.slice(cursor, cursor + length).join('') })
    cursor += length
  }
  return tokens
}

interface RawLine {
  readonly start: number
  readonly times: readonly number[]
  readonly text: string
  readonly translation: boolean
}

/**
 * LRC 解析：
 * - 元数据标签 [ti:][ar:][al:][by:][offset:±ms]
 * - 时间标签 [mm:ss.xx]；单行多时间标签 = 逐字节奏
 * - 同一开始时间出现多行 = 翻译行
 * - 非法行跳过并计数（不抛错，容错优先）
 */
export function parseLrc(raw: string): LrcDocument {
  const metadata: Record<string, string> = {}
  let offsetMs = 0
  let skippedLines = 0
  const rawLines: RawLine[] = []
  const seenStarts = new Set<number>()

  for (const rawLine of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') continue

    const metaMatch = META_TAG.exec(line)
    if (metaMatch !== null) {
      const key = (metaMatch[1] ?? '').toLowerCase()
      const value = (metaMatch[2] ?? '').trim()
      if (key === 'offset') {
        const parsed = Number(value)
        offsetMs = Number.isFinite(parsed) ? parsed : 0
      } else {
        metadata[key] = value
      }
      continue
    }

    const matches = Array.from(line.matchAll(TIME_TAG))
    if (matches.length === 0) {
      skippedLines += 1
      continue
    }
    const times = matches.map((m) => parseTimeTag(m[1] ?? '0', m[2] ?? '0'))
    const text = line.replace(TIME_TAG, '').trim()
    const start = times[0] ?? 0
    const translation = seenStarts.has(start)
    seenStarts.add(start)
    rawLines.push({ start, times, text, translation })
  }

  // 按开始时间分组：首行为主行，其余为翻译行
  const groups = new Map<number, { main?: RawLine; translations: string[] }>()
  for (const rawLine of rawLines) {
    const group = groups.get(rawLine.start) ?? { translations: [] }
    if (rawLine.translation) {
      group.translations.push(rawLine.text)
    } else {
      group.main = rawLine
    }
    groups.set(rawLine.start, group)
  }

  const lines: LyricLine[] = []
  for (const start of [...groups.keys()].sort((a, b) => a - b)) {
    const group = groups.get(start)
    const main = group?.main
    if (main === undefined) continue
    const tokens = splitIntoTokens(main.text, main.times)
    lines.push({
      start,
      tokens,
      text: tokens.map((t) => t.text).join(''),
      translation: (group?.translations[0] ?? '').trim() || null,
    })
  }

  return { lines, metadata, offsetMs, skippedLines }
}
