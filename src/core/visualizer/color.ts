/** 颜色工具：十六进制 ↔ HSL 转换与互补色计算（纯函数可单测）。 */

export type Rgb = readonly [number, number, number]
export type Hsl = readonly [number, number, number]

export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (match === null) return null
  const value = parseInt(match[1] ?? '', 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

export function rgbToHex(rgb: Rgb): string {
  const to2 = (n: number): string =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0')
  return `#${to2(rgb[0])}${to2(rgb[1])}${to2(rgb[2])}`
}

export function rgbToHsl(rgb: Rgb): Hsl {
  const r = (rgb[0] ?? 0) / 255
  const g = (rgb[1] ?? 0) / 255
  const b = (rgb[2] ?? 0) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60
  else if (max === g) h = ((b - r) / d + 2) * 60
  else h = ((r - g) / d + 4) * 60
  return [h, s, l]
}

export function hslToRgb(hsl: Hsl): Rgb {
  const h = (hsl[0] ?? 0) % 360
  const s = hsl[1] ?? 0
  const l = hsl[2] ?? 0
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let rgb: Rgb
  if (h < 60) rgb = [c, x, 0]
  else if (h < 120) rgb = [x, c, 0]
  else if (h < 180) rgb = [0, c, x]
  else if (h < 240) rgb = [0, x, c]
  else if (h < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255]
}

/** 互补色（色相 +180°，明度饱和度不变）；非法输入返回 null。 */
export function complementaryHex(hex: string): string | null {
  const rgb = hexToRgb(hex)
  if (rgb === null) return null
  const hsl = rgbToHsl(rgb)
  return rgbToHex(hslToRgb([((hsl[0] ?? 0) + 180) % 360, hsl[1] ?? 0, hsl[2] ?? 0]))
}
