import { describe, expect, it, vi } from 'vitest'
import { Emitter } from './emitter'

interface TestEvents {
  ping: number
  data: { name: string }
}

describe('Emitter', () => {
  it('delivers payload to subscribers', () => {
    const emitter = new Emitter<TestEvents>()
    const callback = vi.fn()
    emitter.on('ping', callback)
    emitter.emit('ping', 42)
    expect(callback).toHaveBeenCalledExactlyOnceWith(42)
  })

  it('supports multiple listeners', () => {
    const emitter = new Emitter<TestEvents>()
    const a = vi.fn()
    const b = vi.fn()
    emitter.on('ping', a)
    emitter.on('ping', b)
    emitter.emit('ping', 1)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('unsubscribe stops delivery', () => {
    const emitter = new Emitter<TestEvents>()
    const callback = vi.fn()
    const unsubscribe = emitter.on('ping', callback)
    unsubscribe()
    emitter.emit('ping', 1)
    expect(callback).not.toHaveBeenCalled()
  })

  it('emit without listeners does not throw', () => {
    const emitter = new Emitter<TestEvents>()
    expect(() => emitter.emit('data', { name: 'x' })).not.toThrow()
  })

  it('clear removes all listeners', () => {
    const emitter = new Emitter<TestEvents>()
    const callback = vi.fn()
    emitter.on('ping', callback)
    emitter.clear()
    emitter.emit('ping', 1)
    expect(callback).not.toHaveBeenCalled()
  })
})
