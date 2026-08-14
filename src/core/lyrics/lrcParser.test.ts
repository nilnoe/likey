import { describe, expect, it } from 'vitest'
import { parseLrc, splitIntoTokens } from './lrcParser'

describe('splitIntoTokens', () => {
  it('single time → whole line token', () => {
    expect(splitIntoTokens('hello', [1000])).toEqual([{ time: 1000, text: 'hello' }])
  })

  it('multi time → duration-proportional per-char split', () => {
    // 三个时间点等距 → 前两段各 1 字（round(4/3)），末段收尾 2 字
    const tokens = splitIntoTokens('你好世界', [0, 100, 200])
    expect(tokens).toHaveLength(3)
    expect(tokens.map((t) => t.text).join('')).toBe('你好世界')
    expect(tokens.map((t) => t.time)).toEqual([0, 100, 200])
    expect(tokens[0]?.text).toHaveLength(1)
    expect(tokens[1]?.text).toHaveLength(1)
    expect(tokens[2]?.text).toHaveLength(2)
  })

  it('handles empty text and empty times', () => {
    expect(splitIntoTokens('', [1000])).toEqual([{ time: 1000, text: '' }])
    expect(splitIntoTokens('', [])).toEqual([])
  })
})

describe('parseLrc', () => {
  it('parses metadata, offset and standard lines', () => {
    const doc = parseLrc(
      ['[ti:标题]', '[ar:歌手]', '[offset:+500]', '', '[00:12.00]第一句', '[00:15.30]第二句'].join(
        '\n',
      ),
    )
    expect(doc.metadata).toEqual({ ti: '标题', ar: '歌手' })
    expect(doc.offsetMs).toBe(500)
    expect(doc.skippedLines).toBe(0)
    expect(doc.lines).toHaveLength(2)
    expect(doc.lines[0]).toMatchObject({ start: 12000, text: '第一句' })
    expect(doc.lines[1]?.start).toBe(15300)
  })

  it('multi-timestamp line becomes per-char tokens', () => {
    const doc = parseLrc('[00:10.00][00:10.50]逐字歌词')
    const line = doc.lines[0]
    expect(line).toBeDefined()
    expect(line?.tokens.map((t) => t.time)).toEqual([10000, 10500])
    expect(line?.text).toBe('逐字歌词')
    expect(line?.tokens[0]?.text).toBe('逐字')
    expect(line?.tokens[1]?.text).toBe('歌词')
  })

  it('same-time lines become translation', () => {
    const doc = parseLrc('[00:12.00]Hello world\n[00:12.00]你好世界')
    expect(doc.lines).toHaveLength(1)
    expect(doc.lines[0]?.text).toBe('Hello world')
    expect(doc.lines[0]?.translation).toBe('你好世界')
  })

  it('sorts lines by time regardless of input order', () => {
    const doc = parseLrc('[00:20.00]后\n[00:05.00]先')
    expect(doc.lines.map((l) => l.start)).toEqual([5000, 20000])
  })

  it('skips invalid lines and counts them', () => {
    const doc = parseLrc('随便一行\n[00:01.00]有效\n这不是歌词')
    expect(doc.skippedLines).toBe(2)
    expect(doc.lines).toHaveLength(1)
  })

  it('handles BOM, CRLF and empty input', () => {
    const doc = parseLrc('\uFEFF[00:01.00]你好\r\n')
    expect(doc.lines[0]?.text).toBe('你好')
    expect(parseLrc('').lines).toEqual([])
  })

  it('negative offset parses', () => {
    expect(parseLrc('[offset:-300]\n[00:01.00]x').offsetMs).toBe(-300)
  })
})
