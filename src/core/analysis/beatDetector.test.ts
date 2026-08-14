import { describe, expect, it } from 'vitest'
import { BeatDetector, meanOf, stddevOf } from './BeatDetector'

const FRAME_MS = 1000 / 60

interface ClickTrackOptions {
  baseline?: number
  click?: number
  interval?: number
  startFrame?: number
}

function runClickTrack(
  detector: BeatDetector,
  frames: number,
  options: ClickTrackOptions = {},
): Array<{ frame: number; strength: number }> {
  const { baseline = 0.05, click = 1, interval = 30, startFrame = 30 } = options
  const beats: Array<{ frame: number; strength: number }> = []
  for (let f = 0; f < frames; f++) {
    const isClick = f >= startFrame && (f - startFrame) % interval === 0
    const event = detector.update(isClick ? click : baseline, f * FRAME_MS)
    if (event !== null) {
      beats.push({ frame: f, strength: event.strength })
    }
  }
  return beats
}

describe('meanOf / stddevOf', () => {
  it('computes mean and stddev', () => {
    expect(meanOf([])).toBe(0)
    expect(meanOf([1, 2, 3, 4])).toBeCloseTo(2.5)
    expect(stddevOf([7], 7)).toBe(0)
    expect(stddevOf([1, 2, 3, 4], 2.5)).toBeCloseTo(Math.sqrt(1.25))
  })
})

describe('BeatDetector', () => {
  it('detects 120 BPM clicks at 60fps (every 30 frames)', () => {
    const detector = new BeatDetector()
    const beats = runClickTrack(detector, 200)
    expect(beats.map((b) => b.frame)).toEqual([30, 60, 90, 120, 150, 180])
    for (const beat of beats) {
      expect(beat.strength).toBeGreaterThan(1)
    }
  })

  it('emits nothing on silence', () => {
    const detector = new BeatDetector()
    const beats = runClickTrack(detector, 200, { baseline: 0, click: 0 })
    expect(beats).toEqual([])
  })

  it('emits nothing on constant energy', () => {
    const detector = new BeatDetector()
    const beats = runClickTrack(detector, 200, { baseline: 1, click: 1 })
    expect(beats).toEqual([])
  })

  it('adapts to overall loudness scale (threshold is relative)', () => {
    const detector = new BeatDetector()
    const beats = runClickTrack(detector, 200, { baseline: 0.005, click: 0.1 })
    expect(beats.map((b) => b.frame)).toEqual([30, 60, 90, 120, 150, 180])
  })

  it('cooldown suppresses rapid re-fire (250ms)', () => {
    const detector = new BeatDetector()
    // 每 4 帧（66.7ms）一个 click，冷却 250ms → 距上次节拍 ≥250ms 的下一个 click 才触发
    const beats = runClickTrack(detector, 95, { interval: 4, startFrame: 30 })
    expect(beats.map((b) => b.frame)).toEqual([30, 46, 62, 78, 94])
  })

  it('reset clears history and last beat time', () => {
    const detector = new BeatDetector()
    runClickTrack(detector, 100)
    detector.reset()
    const beats = runClickTrack(detector, 100)
    expect(beats.map((b) => b.frame)).toEqual([30, 60, 90])
  })

  it('event time is in the same clock domain as input', () => {
    const detector = new BeatDetector()
    let firstBeatTime: number | null = null
    for (let f = 0; f < 40; f++) {
      const isClick = f >= 30 && (f - 30) % 30 === 0
      const event = detector.update(isClick ? 1 : 0.05, f * FRAME_MS)
      if (event !== null && firstBeatTime === null) {
        firstBeatTime = event.time
      }
    }
    expect(firstBeatTime).toBeCloseTo(30 * FRAME_MS)
  })
})
