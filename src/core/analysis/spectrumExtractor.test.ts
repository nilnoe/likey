import { describe, expect, it } from 'vitest'
import {
  SpectrumExtractor,
  bandEnergy,
  buildLogBuckets,
  type AnalyserLike,
} from './SpectrumExtractor'

const SAMPLE_RATE = 44100
const FFT_SIZE = 2048
const BIN_HZ = SAMPLE_RATE / FFT_SIZE // ≈21.53 Hz/bin
const BIN_COUNT = FFT_SIZE / 2

function makeFakeAnalyser(
  data: Uint8Array,
  timeData: Uint8Array = new Uint8Array(FFT_SIZE).fill(128),
): AnalyserLike {
  return {
    fftSize: FFT_SIZE,
    frequencyBinCount: data.length,
    getByteFrequencyData(array: Uint8Array): void {
      array.set(data)
    },
    getByteTimeDomainData(array: Uint8Array): void {
      array.set(timeData)
    },
  }
}

describe('buildLogBuckets', () => {
  it('hand-verified 4-bar mapping', () => {
    // minFreq=20, maxFreq=20000 → ratio=1000；b0 覆盖 [20, 20·1000^0.25≈112.5)
    const buckets = buildLogBuckets(20, 20000, 4, BIN_HZ, BIN_COUNT)
    expect(buckets[0]).toEqual([0, 6])
    // b1 覆盖 [112.5, 632.5) → bins 5..29
    expect(buckets[1]).toEqual([5, 30])
  })

  it('produces ascending, overlapping-contiguous, in-bounds buckets', () => {
    const buckets = buildLogBuckets(20, 16000, 32, BIN_HZ, BIN_COUNT)
    expect(buckets).toHaveLength(32)
    expect(buckets[0]?.[0]).toBe(0)
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i]
      expect(bucket).toBeDefined()
      const start = bucket?.[0] ?? 0
      const end = bucket?.[1] ?? 0
      expect(end).toBeGreaterThan(start)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(end).toBeLessThanOrEqual(BIN_COUNT)
      if (i > 0) {
        const prevEnd = buckets[i - 1]?.[1] ?? 0
        // 相邻桶允许共享边界 bin（连续性）
        expect(start).toBeLessThanOrEqual(prevEnd)
      }
    }
    // 最高桶应覆盖到高频端附近
    const lastEnd = buckets[buckets.length - 1]?.[1] ?? 0
    expect(lastEnd).toBeGreaterThan(BIN_COUNT / 2)
  })
})

describe('bandEnergy', () => {
  it('returns 1 for full-scale band', () => {
    const raw = new Uint8Array(BIN_COUNT).fill(255)
    expect(bandEnergy(raw, 20, 250, BIN_HZ)).toBe(1)
  })

  it('returns 0 for empty band', () => {
    const raw = new Uint8Array(BIN_COUNT)
    expect(bandEnergy(raw, 20, 250, BIN_HZ)).toBe(0)
  })

  it('computes partial energy', () => {
    const raw = new Uint8Array(BIN_COUNT)
    raw.fill(255, 0, 6) // bins 0..5 满量程，其余 0
    // 20..250Hz → bins 0..11（12 bins），其中 6 个为 255
    expect(bandEnergy(raw, 20, 250, BIN_HZ)).toBeCloseTo(0.5)
    // 250..4000Hz → bins 11..185，全 0
    expect(bandEnergy(raw, 250, 4000, BIN_HZ)).toBe(0)
  })
})

describe('SpectrumExtractor', () => {
  it('extracts log-bucketed bars and band energies', () => {
    const raw = new Uint8Array(BIN_COUNT)
    raw.fill(255, 0, 6) // 能量集中在 bucket 0
    const extractor = new SpectrumExtractor(makeFakeAnalyser(raw), {
      sampleRate: SAMPLE_RATE,
      minFreq: 20,
      maxFreq: 20000,
      barCount: 4,
    })
    const frame = extractor.nextFrame()
    expect(frame.bars).toHaveLength(4)
    expect(frame.bars[0]).toBeCloseTo(1) // bucket 0 = bins [0,6) 全满
    // 相邻桶共享边界 bin（连续性设计）：bucket 1 = [5,30) 含已填充的 bin5 → 1/25
    expect(frame.bars[1]).toBeCloseTo(0.04)
    expect(frame.bars[2]).toBe(0)
    expect(frame.bars[3]).toBe(0)
    // 低频段 20..250 → 12 bins 中 6 个满 → 0.5
    expect(frame.lowEnergy).toBeCloseTo(0.5)
    expect(frame.midEnergy).toBe(0)
    expect(frame.highEnergy).toBe(0)
  })

  it('normalizes full-scale bins to 1', () => {
    const raw = new Uint8Array(BIN_COUNT).fill(255)
    const extractor = new SpectrumExtractor(makeFakeAnalyser(raw), {
      sampleRate: SAMPLE_RATE,
      minFreq: 20,
      maxFreq: 16000,
      barCount: 8,
    })
    const frame = extractor.nextFrame()
    for (const bar of frame.bars) {
      expect(bar).toBe(1)
    }
    expect(frame.lowEnergy).toBe(1)
  })

  it('captures time-domain waveform samples', () => {
    const raw = new Uint8Array(BIN_COUNT)
    const time = new Uint8Array(FFT_SIZE).fill(200)
    const extractor = new SpectrumExtractor(makeFakeAnalyser(raw, time), {
      sampleRate: SAMPLE_RATE,
      minFreq: 20,
      maxFreq: 16000,
      barCount: 8,
    })
    const frame = extractor.nextFrame()
    expect(frame.waveform).toHaveLength(FFT_SIZE)
    expect(frame.waveform[0]).toBe(200)
    expect(frame.waveform[FFT_SIZE - 1]).toBe(200)
  })

  it('setBarCount rebuilds bars and buckets', () => {
    const raw = new Uint8Array(BIN_COUNT)
    const extractor = new SpectrumExtractor(makeFakeAnalyser(raw), {
      sampleRate: SAMPLE_RATE,
      minFreq: 20,
      maxFreq: 20000,
      barCount: 4,
    })
    expect(extractor.barCount).toBe(4)
    extractor.setBarCount(64)
    expect(extractor.barCount).toBe(64)
    const frame = extractor.nextFrame()
    expect(frame.bars).toHaveLength(64)
    extractor.setBarCount(64) // 同值不重建
    expect(extractor.barCount).toBe(64)
    extractor.setBarCount(0) // 非法值忽略
    expect(extractor.barCount).toBe(64)
  })
})
