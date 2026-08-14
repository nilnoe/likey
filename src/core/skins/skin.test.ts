import { describe, expect, it } from 'vitest'
import { BUILTIN_SKINS, parseSkin } from './skin'

const VALID_SKIN = {
  id: 'test',
  name: '测试皮肤',
  version: 1,
  colorScheme: 'dark',
  colors: {
    appBg: '#000000',
    panelBg: '#111111',
    panelBorder: '#222222',
    textPrimary: '#ffffff',
    textSecondary: '#999999',
    accent: '#00ffff',
    spectrum: ['#00ff00', '#ff00ff'],
    lyricActive: '#ffffff',
    lyricProgress: '#00ffff',
    lyricInactive: '#666666',
  },
  spectrumStyle: {
    barCount: 48,
    mirror: true,
    rounded: true,
    gap: 2,
    fallSpeed: 0.9,
    peakHold: true,
    beatPulse: true,
  },
  lyrics: { fontSize: 16, lineHeight: 1.5 },
}

describe('parseSkin', () => {
  it('accepts a valid skin', () => {
    const result = parseSkin(JSON.stringify(VALID_SKIN))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.skin.id).toBe('test')
      expect(result.skin.spectrumStyle.barCount).toBe(48)
      expect(result.skin.colors.spectrum).toEqual(['#00ff00', '#ff00ff'])
      // 缺省时 glow 走默认值 true
      expect(result.skin.spectrumStyle.glow).toBe(true)
    }
  })

  it('accepts explicit glow toggle', () => {
    const skin = {
      ...VALID_SKIN,
      spectrumStyle: { ...VALID_SKIN.spectrumStyle, glow: false },
    }
    const result = parseSkin(JSON.stringify(skin))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.skin.spectrumStyle.glow).toBe(false)
    }
  })

  it('rejects invalid JSON', () => {
    expect(parseSkin('{oops')).toMatchObject({ ok: false })
  })

  it('rejects non-object root', () => {
    expect(parseSkin('42')).toMatchObject({ ok: false })
    expect(parseSkin('[]')).toMatchObject({ ok: false })
  })

  it('rejects missing required fields', () => {
    const { id: _id, ...withoutId } = VALID_SKIN
    expect(parseSkin(JSON.stringify(withoutId))).toMatchObject({ ok: false })
    const { colors: _colors, ...withoutColors } = VALID_SKIN
    expect(parseSkin(JSON.stringify(withoutColors))).toMatchObject({ ok: false })
  })

  it('rejects wrong field types and ranges', () => {
    const badSpectrum = {
      ...VALID_SKIN,
      spectrumStyle: { ...VALID_SKIN.spectrumStyle, barCount: 3 },
    }
    expect(parseSkin(JSON.stringify(badSpectrum))).toMatchObject({ ok: false })
    const badSpeed = {
      ...VALID_SKIN,
      spectrumStyle: { ...VALID_SKIN.spectrumStyle, fallSpeed: 1 },
    }
    expect(parseSkin(JSON.stringify(badSpeed))).toMatchObject({ ok: false })
    const badScheme = { ...VALID_SKIN, colorScheme: 'neon' }
    expect(parseSkin(JSON.stringify(badScheme))).toMatchObject({ ok: false })
    const badGlow = {
      ...VALID_SKIN,
      spectrumStyle: { ...VALID_SKIN.spectrumStyle, glow: 'yes' },
    }
    expect(parseSkin(JSON.stringify(badGlow))).toMatchObject({ ok: false })
  })

  it('rejects spectrum gradient that is not a 2-tuple', () => {
    const bad = {
      ...VALID_SKIN,
      colors: { ...VALID_SKIN.colors, spectrum: ['#fff'] },
    }
    expect(parseSkin(JSON.stringify(bad))).toMatchObject({ ok: false })
  })

  it('all builtin skins pass validation round-trip', () => {
    for (const skin of BUILTIN_SKINS) {
      const result = parseSkin(JSON.stringify(skin))
      expect(result.ok).toBe(true)
    }
  })
})
