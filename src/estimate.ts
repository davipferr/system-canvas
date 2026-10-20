// Back-of-the-envelope estimation: the first five minutes of every system design interview.
// Turn "how many users, doing what" into requests per second, storage and bandwidth, using
// round decimal units (1 KB = 1,000 bytes) because the point is the order of magnitude.

export const SECONDS_PER_DAY = 86_400

export interface EstimateInput {
  dailyActiveUsers: number
  requestsPerUserPerDay: number
  /** Percentage of requests that are reads. */
  readPercent: number
  /** How much busier the busiest hour is than the daily average (2–3 is typical). */
  peakFactor: number
  /** Bytes stored by each write, in KB. */
  writeSizeKB: number
  /** Bytes returned by each read, in KB. */
  readSizeKB: number
  /** How long data is kept, in years. */
  retentionYears: number
  /** How many copies of every byte are stored (3 is the classic default). */
  replication: number
  /** Share of a day's read traffic worth keeping in cache, in percent (the 80/20 rule says 20). */
  cacheHotPercent: number
}

export interface Estimate {
  requestsPerDay: number
  readsPerDay: number
  writesPerDay: number
  averageRps: number
  peakRps: number
  peakReadRps: number
  peakWriteRps: number
  /** New data written per day, before replication. */
  storagePerDay: number
  /** Everything kept for the retention period, with replication. */
  storageTotal: number
  /** Average bytes per second coming in (writes) and going out (reads). */
  ingressPerSecond: number
  egressPerSecond: number
  peakEgressPerSecond: number
  /** Memory to cache the hot share of a day's reads. */
  cacheSize: number
}

const KB = 1_000

export function estimate(input: EstimateInput): Estimate {
  const requestsPerDay = input.dailyActiveUsers * input.requestsPerUserPerDay
  const readShare = input.readPercent / 100
  const readsPerDay = requestsPerDay * readShare
  const writesPerDay = requestsPerDay - readsPerDay
  const averageRps = requestsPerDay / SECONDS_PER_DAY
  const peakRps = averageRps * input.peakFactor
  const storagePerDay = writesPerDay * input.writeSizeKB * KB
  const egressPerDay = readsPerDay * input.readSizeKB * KB

  return {
    requestsPerDay,
    readsPerDay,
    writesPerDay,
    averageRps,
    peakRps,
    peakReadRps: peakRps * readShare,
    peakWriteRps: peakRps * (1 - readShare),
    storagePerDay,
    storageTotal: storagePerDay * 365 * input.retentionYears * input.replication,
    ingressPerSecond: storagePerDay / SECONDS_PER_DAY,
    egressPerSecond: egressPerDay / SECONDS_PER_DAY,
    peakEgressPerSecond: (egressPerDay / SECONDS_PER_DAY) * input.peakFactor,
    cacheSize: egressPerDay * (input.cacheHotPercent / 100),
  }
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB']

/** 1,234,567 → "1.2 MB" (decimal units, as estimates use). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const exponent = Math.min(UNITS.length - 1, Math.floor(Math.log10(bytes) / 3))
  const value = bytes / 1000 ** exponent
  const digits = value >= 100 || exponent === 0 ? 0 : 1
  return `${Number(value.toFixed(digits)).toLocaleString('en-US')} ${UNITS[exponent]}`
}

/** 12,345,678 → "12.3M", 4,200 → "4.2k": readable big counts. */
export function formatCount(n: number): string {
  const abs = Math.abs(n)
  const scaled = (value: number, suffix: string) =>
    `${Number(value.toFixed(value >= 100 ? 0 : 1)).toLocaleString('en-US')}${suffix}`
  if (abs >= 1e12) return scaled(n / 1e12, 'T')
  if (abs >= 1e9) return scaled(n / 1e9, 'B')
  if (abs >= 1e6) return scaled(n / 1e6, 'M')
  if (abs >= 1e4) return scaled(n / 1e3, 'k')
  return Math.round(n).toLocaleString('en-US')
}
