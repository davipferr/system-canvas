import { describe, expect, it } from 'vitest'
import { estimate, formatBytes, formatCount, SECONDS_PER_DAY, type EstimateInput } from 'system-canvas'

// A classic interview-style example with numbers that are easy to check by hand.
const input: EstimateInput = {
  dailyActiveUsers: 10_000_000,
  requestsPerUserPerDay: 20,
  readPercent: 90,
  peakFactor: 3,
  writeSizeKB: 1,
  readSizeKB: 10,
  retentionYears: 5,
  replication: 3,
  cacheHotPercent: 20,
}

describe('estimate', () => {
  const e = estimate(input)

  it('turns daily users into requests per second', () => {
    expect(e.requestsPerDay).toBe(200_000_000)
    expect(e.readsPerDay).toBe(180_000_000)
    expect(e.writesPerDay).toBeCloseTo(20_000_000)
    expect(e.averageRps).toBeCloseTo(200_000_000 / SECONDS_PER_DAY) // ≈ 2,315
    expect(e.peakRps).toBeCloseTo(e.averageRps * 3) // ≈ 6,944
    expect(e.peakReadRps + e.peakWriteRps).toBeCloseTo(e.peakRps)
    expect(e.peakWriteRps).toBeCloseTo(e.peakRps * 0.1)
  })

  it('sizes storage: writes × size per day, × days × years × copies in total', () => {
    expect(e.storagePerDay).toBeCloseTo(20e9) // 20M writes × 1 KB = 20 GB a day
    expect(e.storageTotal).toBeCloseTo(20e9 * 365 * 5 * 3) // ≈ 110 TB
  })

  it('sizes bandwidth and the cache', () => {
    expect(e.ingressPerSecond).toBeCloseTo(20e9 / SECONDS_PER_DAY) // ≈ 231 KB/s
    expect(e.egressPerSecond).toBeCloseTo(1.8e12 / SECONDS_PER_DAY) // ≈ 20.8 MB/s
    expect(e.peakEgressPerSecond).toBeCloseTo(e.egressPerSecond * 3)
    expect(e.cacheSize).toBeCloseTo(1.8e12 * 0.2) // 20% of a day's reads: 360 GB
  })

  it('handles zero users', () => {
    const zero = estimate({ ...input, dailyActiveUsers: 0 })
    expect(zero.peakRps).toBe(0)
    expect(zero.storageTotal).toBe(0)
  })
})

describe('formatting', () => {
  it('formats bytes with decimal units', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(1_500)).toBe('1.5 KB')
    expect(formatBytes(20e9)).toBe('20 GB')
    expect(formatBytes(109.5e12)).toBe('110 TB')
    expect(formatBytes(3.2e15)).toBe('3.2 PB')
  })

  it('formats big counts', () => {
    expect(formatCount(950)).toBe('950')
    expect(formatCount(4_200)).toBe('4,200')
    expect(formatCount(42_000)).toBe('42k')
    expect(formatCount(12_345_678)).toBe('12.3M')
    expect(formatCount(2.5e9)).toBe('2.5B')
  })
})
