import { describe, expect, it, vi } from 'vitest'
import type { PlayerStatus } from './PlayerCore'
import { QueueController, type QueuePlayer } from './QueueController'
import { createShuffleOrder, type PlaylistTrack, type TrackSource } from './Queue'

/** 冲刷微任务队列（handleTrackEnd → playIndex → readFile → load 为多级 await）。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
  }
}

class FakePlayer implements QueuePlayer {
  readonly loaded: Array<{ id: string; name: string }> = []
  playCount = 0
  stopCount = 0
  private endCallbacks: Array<() => void> = []

  async load(track: { id: string; name: string }, _data: ArrayBuffer): Promise<void> {
    this.loaded.push({ id: track.id, name: track.name })
  }

  async play(): Promise<void> {
    this.playCount += 1
  }

  stop(): void {
    this.stopCount += 1
  }

  seek(_seconds: number): void {}

  getStatus(): PlayerStatus {
    const name = this.loaded.at(-1)?.name
    return name === undefined ? { kind: 'idle' } : { kind: 'playing', trackName: name }
  }

  onTrackEnd(callback: () => void): () => void {
    this.endCallbacks.push(callback)
    return () => {
      this.endCallbacks = this.endCallbacks.filter((cb) => cb !== callback)
    }
  }

  fireEnd(): void {
    for (const cb of this.endCallbacks) {
      cb()
    }
  }
}

function makeFiles(names: readonly string[]): File[] {
  return names.map((name) => new File(['x'], name))
}

function makeController(
  player: FakePlayer,
  seed = 0,
): { controller: QueueController; readSource: ReturnType<typeof vi.fn> } {
  const readSource = vi.fn(async (_source: TrackSource) => new ArrayBuffer(4))
  const controller = new QueueController(player, {
    readSource,
    seedProvider: () => seed,
  })
  return { controller, readSource }
}

function makeLibraryTracks(names: readonly string[]): PlaylistTrack[] {
  return names.map((name) => ({
    id: `lib-${name}`,
    name,
    source: { kind: 'url', url: `asset:///music/${name}` },
  }))
}

describe('QueueController', () => {
  it('addFiles appends without playing when queue non-empty', async () => {
    const player = new FakePlayer()
    const { controller } = makeController(player)
    await controller.addFiles(makeFiles(['a.mp3']), true)
    expect(controller.getSnapshot().tracks).toHaveLength(1)
    expect(player.loaded.map((t) => t.name)).toEqual(['a.mp3'])
    expect(player.playCount).toBe(1)
    await controller.addFiles(makeFiles(['b.mp3']))
    expect(player.loaded).toHaveLength(1) // 不自动播放
    expect(controller.getSnapshot().index).toBe(0)
  })

  it('playIndex loads and plays the selected track', async () => {
    const player = new FakePlayer()
    const { controller } = makeController(player)
    await controller.addFiles(makeFiles(['a.mp3', 'b.mp3', 'c.mp3']))
    await controller.playIndex(2)
    expect(player.loaded.at(-1)?.name).toBe('c.mp3')
    expect(controller.getSnapshot().index).toBe(2)
  })

  it('addTracks appends library tracks and dedupes by id', async () => {
    const player = new FakePlayer()
    const { controller, readSource } = makeController(player)
    await controller.addTracks(makeLibraryTracks(['a.mp3', 'b.mp3']), true)
    expect(controller.getSnapshot().tracks).toHaveLength(2)
    expect(player.loaded.map((t) => t.name)).toEqual(['a.mp3'])
    expect(readSource).toHaveBeenCalledWith({ kind: 'url', url: 'asset:///music/a.mp3' })
    await controller.addTracks(makeLibraryTracks(['a.mp3', 'c.mp3']))
    expect(controller.getSnapshot().tracks).toHaveLength(3) // a 去重，新增 c
  })

  it('auto-advances on track end', async () => {
    const player = new FakePlayer()
    const { controller } = makeController(player)
    await controller.addFiles(makeFiles(['a.mp3', 'b.mp3', 'c.mp3']), true)
    player.fireEnd()
    await flush()
    expect(controller.getSnapshot().index).toBe(1)
    expect(player.loaded.at(-1)?.name).toBe('b.mp3')
  })

  it('emits queueEnded at the end with repeat off', async () => {
    const player = new FakePlayer()
    const { controller } = makeController(player)
    const onEnded = vi.fn()
    controller.onQueueEnded(onEnded)
    await controller.addFiles(makeFiles(['a.mp3', 'b.mp3']), true)
    player.fireEnd() // → b
    await flush()
    const loadedBefore = player.loaded.length
    player.fireEnd() // 到底
    await flush()
    expect(onEnded).toHaveBeenCalledTimes(1)
    expect(player.loaded).toHaveLength(loadedBefore)
  })

  it('wraps to first track with repeat all', async () => {
    const player = new FakePlayer()
    const { controller } = makeController(player)
    await controller.addFiles(makeFiles(['a.mp3', 'b.mp3']), true)
    controller.setRepeat('all')
    player.fireEnd() // → b
    await flush()
    player.fireEnd() // → a（回绕）
    await flush()
    expect(player.loaded.map((t) => t.name)).toEqual(['a.mp3', 'b.mp3', 'a.mp3'])
  })

  it('replays current track with repeat one', async () => {
    const player = new FakePlayer()
    const { controller } = makeController(player)
    await controller.addFiles(makeFiles(['a.mp3', 'b.mp3']), true)
    controller.setRepeat('one')
    const loadedBefore = player.loaded.length
    player.fireEnd()
    await flush()
    expect(player.loaded).toHaveLength(loadedBefore) // 不加载新曲
    expect(player.playCount).toBe(2) // 重播
    expect(controller.getSnapshot().index).toBe(0)
  })

  it('shuffle auto-advance follows the seeded order', async () => {
    const player = new FakePlayer()
    const { controller } = makeController(player, 42)
    const onEnded = vi.fn()
    controller.onQueueEnded(onEnded)
    await controller.addFiles(makeFiles(['a.mp3', 'b.mp3', 'c.mp3', 'd.mp3']), true)
    controller.toggleShuffle()
    expect(controller.getSnapshot().shuffle).toBe(true)

    const order = createShuffleOrder(4, 42)
    const visited: number[] = [controller.getSnapshot().index]
    for (let i = 0; i < 3; i++) {
      player.fireEnd()
      await flush()
      visited.push(controller.getSnapshot().index)
    }
    // 初始在曲目 0，此后沿 order 中 0 之后的位置前进（4 首共 3 次推进）
    const pos0 = order.indexOf(0)
    expect(visited).toEqual([0, ...order.slice(pos0 + 1)])
    // 洗牌顺序到底（repeat off）→ queueEnded，索引不变
    player.fireEnd()
    await flush()
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('manual next/prev wrap unconditionally', async () => {
    const player = new FakePlayer()
    const { controller } = makeController(player)
    await controller.addFiles(makeFiles(['a.mp3', 'b.mp3', 'c.mp3']))
    await controller.playIndex(2)
    await controller.next()
    expect(controller.getSnapshot().index).toBe(0)
    await controller.prev()
    expect(controller.getSnapshot().index).toBe(2)
  })

  it('removeAt stops playback when removing current track and adjusts index', async () => {
    const player = new FakePlayer()
    const { controller } = makeController(player)
    await controller.addFiles(makeFiles(['a.mp3', 'b.mp3', 'c.mp3']), true)
    controller.removeAt(0)
    expect(controller.getSnapshot().tracks.map((t) => t.name)).toEqual(['b.mp3', 'c.mp3'])
    expect(controller.getSnapshot().index).toBe(0) // 移除当前 → 停在原位（新 index 0）
    expect(player.stopCount).toBe(1)
    controller.removeAt(1)
    expect(controller.getSnapshot().index).toBe(0)
    controller.removeAt(0)
    expect(controller.getSnapshot().tracks).toHaveLength(0)
    expect(controller.getSnapshot().index).toBe(-1)
  })

  it('clear resets queue and stops player', async () => {
    const player = new FakePlayer()
    const { controller } = makeController(player)
    await controller.addFiles(makeFiles(['a.mp3']), true)
    controller.clear()
    expect(controller.getSnapshot()).toEqual({
      tracks: [],
      index: -1,
      repeat: 'off',
      shuffle: false,
    })
    expect(player.stopCount).toBe(1)
  })

  it('dispose unsubscribes from track end', async () => {
    const player = new FakePlayer()
    const { controller } = makeController(player)
    await controller.addFiles(makeFiles(['a.mp3', 'b.mp3']), true)
    controller.dispose()
    player.fireEnd()
    await flush()
    expect(controller.getSnapshot().index).toBe(0) // 不再自动推进
  })
})
