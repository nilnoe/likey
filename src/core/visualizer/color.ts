/** 颜色工具：十六进制解析与透明度合成（纯函数可单测）。 */

export type Rgb = readonly [number, number, number]

export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (match === null) return null
  const value = parseInt(match[1] ?? '', 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

/** 给十六进制颜色附加 alpha，输出 CSS rgba() 字符串；非法输入返回 null。 */
export function hexWithAlpha(hex: string, alpha: number): string | null {
  const rgb = hexToRgb(hex)
  if (rgb === null) return null
  const a = Math.min(1, Math.max(0, alpha))
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`
}
