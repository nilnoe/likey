import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeDecodeError, probeFormat } from './probe'

describe('describeDecodeError', () => {
  it('recognizes NotSupportedError', () => {
    const error = new DOMException('unsupported', 'NotSupportedError')
    expect(describeDecodeError(error)).toContain('WASM')
  })

  it('falls back to error message', () => {
    expect(describeDecodeError(new Error('boom'))).toBe('boom')
    expect(describeDecodeError('plain')).toBe('plain')
  })
})

describe('probeFormat', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports ok with duration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })),
    )
    const decoder = { decode: async (): Promise<{ duration: number }> => ({ duration: 1.5 }) }
    const result = await probeFormat('wav', '/tone.wav', decoder)
    expect(result).toEqual({ format: 'wav', ok: true, duration: 1.5 })
  })

  it('reports http error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 404 })),
    )
    const decoder = { decode: async (): Promise<{ duration: number }> => ({ duration: 1 }) }
    const result = await probeFormat('mp3', '/tone.mp3', decoder)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('HTTP 404')
  })

  it('reports decode failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })),
    )
    const decoder = {
      decode: async (): Promise<{ duration: number }> => {
        throw new DOMException('unsupported', 'NotSupportedError')
      },
    }
    const result = await probeFormat('flac', '/tone.flac', decoder)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('WASM')
  })
})
