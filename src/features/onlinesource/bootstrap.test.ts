import { describe, expect, it } from 'vitest'
import { SANDBOX_BOOTSTRAP_PRE, SANDBOX_BOOTSTRAP_POST, escapeScriptCode } from './bootstrap'

describe('escapeScriptCode', () => {
  it('escapes closing script tags (case-insensitive)', () => {
    expect(escapeScriptCode("document.write('</script>')")).toBe("document.write('<\\/script>')")
    // 匹配大小写不敏感，替换串固定为小写 \/script
    expect(escapeScriptCode('a</SCRIPT>b')).toBe('a<\\/script>b')
  })

  it('keeps normal code intact', () => {
    const code = 'window.source = { search: function () { return [] } }'
    expect(escapeScriptCode(code)).toBe(code)
  })
})

describe('sandbox bootstrap', () => {
  it('is safe to inline into a script tag (no closing tag sequence)', () => {
    for (const segment of [SANDBOX_BOOTSTRAP_PRE, SANDBOX_BOOTSTRAP_POST]) {
      expect(segment).not.toMatch(/<\/script/i)
    }
  })

  it('contains the protocol hooks', () => {
    expect(SANDBOX_BOOTSTRAP_PRE).toContain('parent.postMessage')
    expect(SANDBOX_BOOTSTRAP_PRE).toContain("data.type === 'fetch-response'")
    expect(SANDBOX_BOOTSTRAP_PRE).toContain("data.type !== 'call'")
    expect(SANDBOX_BOOTSTRAP_POST).toContain("type: 'ready'")
  })
})
