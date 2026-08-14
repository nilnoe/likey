import { DEFAULT_SPECTRUM_STYLE, type SpectrumStyle } from '../visualizer/SpectrumStyle'

/** 皮肤协议（JSON 文件与此同构；DESIGN §9.1）。 */
export interface Skin {
  readonly id: string
  readonly name: string
  readonly version: 1
  readonly colorScheme: 'dark' | 'light'
  readonly colors: {
    readonly appBg: string
    readonly panelBg: string
    readonly panelBorder: string
    readonly textPrimary: string
    readonly textSecondary: string
    readonly accent: string
    /** 频谱渐变 [底色, 顶色] */
    readonly spectrum: readonly [string, string]
    readonly lyricActive: string
    readonly lyricProgress: string
    readonly lyricInactive: string
  }
  /** 直接注入 SpectrumBarRenderer */
  readonly spectrumStyle: SpectrumStyle
  readonly lyrics: {
    readonly fontSize: number
    readonly lineHeight: number
  }
}

export type SkinParseResult =
  { readonly ok: true; readonly skin: Skin } | { readonly ok: false; readonly error: string }

function fail(message: string): SkinParseResult {
  return { ok: false, error: message }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key]
  return typeof value === 'boolean' ? value : null
}

/** 解析并校验皮肤 JSON；任何字段缺失/类型错误都给出可读错误信息。 */
export function parseSkin(json: string): SkinParseResult {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch (error: unknown) {
    return fail(`JSON 解析失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(data)) return fail('皮肤根节点必须是 JSON 对象')

  const id = readString(data, 'id')
  const name = readString(data, 'name')
  if (id === null) return fail('缺少字段 id（string）')
  if (name === null) return fail('缺少字段 name（string）')
  const version = readNumber(data, 'version')
  if (version !== 1) return fail('version 必须为 1')
  const colorScheme = readString(data, 'colorScheme')
  if (colorScheme !== 'dark' && colorScheme !== 'light') {
    return fail('colorScheme 必须是 "dark" 或 "light"')
  }

  const colorsRaw = data['colors']
  if (!isRecord(colorsRaw)) return fail('缺少 colors 对象')
  const colorKeys = [
    'appBg',
    'panelBg',
    'panelBorder',
    'textPrimary',
    'textSecondary',
    'accent',
    'lyricActive',
    'lyricProgress',
    'lyricInactive',
  ] as const
  const colors: Record<string, string> = {}
  for (const key of colorKeys) {
    const value = readString(colorsRaw, key)
    if (value === null) return fail(`colors.${key} 必须是非空字符串`)
    colors[key] = value
  }
  const spectrumColors = colorsRaw['spectrum']
  if (
    !Array.isArray(spectrumColors) ||
    spectrumColors.length !== 2 ||
    typeof spectrumColors[0] !== 'string' ||
    typeof spectrumColors[1] !== 'string'
  ) {
    return fail('colors.spectrum 必须是 [底色, 顶色] 两个字符串')
  }

  const spectrumRaw = data['spectrumStyle']
  if (!isRecord(spectrumRaw)) return fail('缺少 spectrumStyle 对象')
  const barCount = readNumber(spectrumRaw, 'barCount')
  if (barCount === null || barCount < 8 || barCount > 128 || !Number.isInteger(barCount)) {
    return fail('spectrumStyle.barCount 必须是 8..128 的整数')
  }
  const gap = readNumber(spectrumRaw, 'gap')
  if (gap === null || gap < 0 || gap > 20) return fail('spectrumStyle.gap 必须是 0..20')
  const fallSpeed = readNumber(spectrumRaw, 'fallSpeed')
  if (fallSpeed === null || fallSpeed <= 0 || fallSpeed >= 1) {
    return fail('spectrumStyle.fallSpeed 必须在 (0, 1) 区间')
  }
  const mirror = readBoolean(spectrumRaw, 'mirror')
  const rounded = readBoolean(spectrumRaw, 'rounded')
  const peakHold = readBoolean(spectrumRaw, 'peakHold')
  const beatPulse = readBoolean(spectrumRaw, 'beatPulse')
  if (mirror === null || rounded === null || peakHold === null || beatPulse === null) {
    return fail('spectrumStyle 的 mirror/rounded/peakHold/beatPulse 必须是布尔值')
  }
  // glow 为可选字段：缺省走渲染器默认值（true），提供则必须是布尔
  const glow = readBoolean(spectrumRaw, 'glow') ?? true
  if ('glow' in spectrumRaw && typeof spectrumRaw['glow'] !== 'boolean') {
    return fail('spectrumStyle.glow 必须是布尔值')
  }
  // mode 为可选字段：缺省走默认值（liquid），提供则必须是 bars 或 liquid
  const modeRaw = readString(spectrumRaw, 'mode')
  if (modeRaw !== null && modeRaw !== 'bars' && modeRaw !== 'liquid') {
    return fail('spectrumStyle.mode 必须是 "bars" 或 "liquid"')
  }
  const mode = modeRaw === 'bars' ? 'bars' : 'liquid'

  const lyricsRaw = data['lyrics']
  if (!isRecord(lyricsRaw)) return fail('缺少 lyrics 对象')
  const fontSize = readNumber(lyricsRaw, 'fontSize')
  if (fontSize === null || fontSize < 8 || fontSize > 72) {
    return fail('lyrics.fontSize 必须在 8..72')
  }
  const lineHeight = readNumber(lyricsRaw, 'lineHeight')
  if (lineHeight === null || lineHeight < 0.5 || lineHeight > 4) {
    return fail('lyrics.lineHeight 必须在 0.5..4')
  }

  return {
    ok: true,
    skin: {
      id,
      name,
      version: 1,
      colorScheme,
      colors: {
        appBg: colors['appBg'] ?? '',
        panelBg: colors['panelBg'] ?? '',
        panelBorder: colors['panelBorder'] ?? '',
        textPrimary: colors['textPrimary'] ?? '',
        textSecondary: colors['textSecondary'] ?? '',
        accent: colors['accent'] ?? '',
        spectrum: [spectrumColors[0], spectrumColors[1]],
        lyricActive: colors['lyricActive'] ?? '',
        lyricProgress: colors['lyricProgress'] ?? '',
        lyricInactive: colors['lyricInactive'] ?? '',
      },
      spectrumStyle: {
        barCount,
        mirror,
        rounded,
        gap,
        gradient: [spectrumColors[0], spectrumColors[1]],
        peakHold,
        fallSpeed,
        beatPulse,
        glow,
        mode,
      },
      lyrics: { fontSize, lineHeight },
    },
  }
}

/** 内置皮肤：classic（千千静听风深蓝）、dark-cyan（现代深色）、paper（浅色）。 */
export const BUILTIN_SKINS: readonly Skin[] = [
  {
    id: 'classic',
    name: '经典 · 千千静听',
    version: 1,
    colorScheme: 'dark',
    colors: {
      appBg: '#0a0e1a',
      panelBg: '#101828',
      panelBorder: '#1e2a44',
      textPrimary: '#e8ecf4',
      textSecondary: '#8d99b0',
      accent: '#00e5ff',
      spectrum: ['#00e5ff', '#7c4dff'],
      lyricActive: '#ffffff',
      lyricProgress: '#00e5ff',
      lyricInactive: '#8d99b0',
    },
    spectrumStyle: { ...DEFAULT_SPECTRUM_STYLE, mirror: true, barCount: 48 },
    lyrics: { fontSize: 16, lineHeight: 1.5 },
  },
  {
    id: 'dark-cyan',
    name: '现代 · 深青',
    version: 1,
    colorScheme: 'dark',
    colors: {
      appBg: '#0b0f14',
      panelBg: '#131a22',
      panelBorder: '#1f2a36',
      textPrimary: '#e6edf3',
      textSecondary: '#8b98a5',
      accent: '#22d3ee',
      spectrum: ['#22d3ee', '#a855f7'],
      lyricActive: '#ffffff',
      lyricProgress: '#22d3ee',
      lyricInactive: '#8b98a5',
    },
    spectrumStyle: { ...DEFAULT_SPECTRUM_STYLE, mirror: true, barCount: 48 },
    lyrics: { fontSize: 16, lineHeight: 1.5 },
  },
  {
    id: 'paper',
    name: '浅色 · 纸面',
    version: 1,
    colorScheme: 'light',
    colors: {
      appBg: '#f5f5f4',
      panelBg: '#ffffff',
      panelBorder: '#e0e0e0',
      textPrimary: '#1c1917',
      textSecondary: '#78716c',
      accent: '#0d9488',
      spectrum: ['#0d9488', '#f59e0b'],
      lyricActive: '#1c1917',
      lyricProgress: '#0d9488',
      lyricInactive: '#a8a29e',
    },
    spectrumStyle: { ...DEFAULT_SPECTRUM_STYLE, mirror: false, barCount: 64 },
    lyrics: { fontSize: 16, lineHeight: 1.5 },
  },
]
