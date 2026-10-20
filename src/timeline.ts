// Time: a simulated clock, traffic that changes over the day, and the metrics a monitoring
// system would record at each moment. The models elsewhere are steady-state; here we evaluate
// them again at every tick with that moment's traffic, so a dashboard can show lines moving.

import { percentileOf, type RequestSample } from './sre'
import { totalOf, type SimulationResult } from './simulate'

export type TrafficPattern = 'steady' | 'daily' | 'spike' | 'ramp'

export const TRAFFIC_PATTERNS: { id: TrafficPattern; label: string; description: string }[] = [
  { id: 'steady', label: 'Steady', description: 'The same traffic all the time.' },
  {
    id: 'daily',
    label: 'Daily cycle',
    description: 'Quiet at 8:00 (30% of peak), busiest at 20:00 (100%), like most consumer apps.',
  },
  {
    id: 'spike',
    label: 'Hourly spike',
    description: 'Normal traffic with a 5-minute burst to 3× at half past every hour: a push notification, a TV ad.',
  },
  {
    id: 'ramp',
    label: 'Ramp',
    description: 'Grows from 0.5× to 2× over every hour, then drops back: watch where it breaks.',
  },
]

export const MINUTES_PER_DAY = 24 * 60
/** The clock starts on day 1 at 08:00. */
export const CLOCK_START = 8 * 60

/** Traffic multiplier at `minutes` since day 1 00:00. */
export function patternMultiplier(pattern: TrafficPattern, minutes: number): number {
  switch (pattern) {
    case 'steady':
      return 1
    case 'daily': {
      const hour = (minutes % MINUTES_PER_DAY) / 60
      // A cosine peaking at 20:00 (1.0) with its low at 08:00 (0.3).
      return 0.65 + 0.35 * Math.cos((2 * Math.PI * (hour - 20)) / 24)
    }
    case 'spike': {
      const m = minutes % 60
      if (m < 30 || m >= 36) return 1
      if (m < 31) return 1 + 2 * (m - 30) // ramp up over a minute
      if (m < 35) return 3
      return 3 - 2 * (m - 35) // and back down
    }
    case 'ramp':
      return 0.5 + 1.5 * ((minutes % 60) / 60)
  }
}

/** 905 → "Day 1 · 15:05" */
export function formatClock(minutes: number): string {
  const day = Math.floor(minutes / MINUTES_PER_DAY) + 1
  const inDay = Math.floor(minutes % MINUTES_PER_DAY)
  const hh = String(Math.floor(inDay / 60)).padStart(2, '0')
  const mm = String(inDay % 60).padStart(2, '0')
  return `Day ${day} · ${hh}:${mm}`
}

export interface NodeMetrics {
  rps: number
  /** Average time spent here, in ms. */
  latency: number
  utilization: number
  /** Share of its requests that fail, as its callers see them. */
  errorRate: number
  /** Jobs per second piling up in the queue in front of it. */
  backlog: number
  failed: boolean
}

/** Everything the dashboard plots for one moment. */
export interface MetricPoint {
  /** Simulated minutes since day 1 00:00. */
  t: number
  /** Traffic multiplier in effect (pattern × load multiplier). */
  multiplier: number
  rps: number
  p50: number
  p99: number
  /** Latency at the SLO's own percentile (p99 unless the SLO says otherwise). */
  sloLatency: number
  errorRate: number
  /** Error rate ÷ error budget (1 = spending the budget exactly on schedule). */
  burnRate: number
  maxUtilization: number
  /** Total queue backlog growth, in jobs per second. */
  backlog: number
  nodes: Record<string, NodeMetrics>
}

export function metricPoint(
  t: number,
  multiplier: number,
  sim: SimulationResult,
  sample: RequestSample,
  errorBudget: number,
  sloPercentile = 99,
): MetricPoint {
  const nodes: Record<string, NodeMetrics> = {}
  let maxUtilization = 0
  for (const [id, stats] of Object.entries(sim.nodes)) {
    const seen = sample.nodes[id]
    const load = totalOf(stats.load)
    nodes[id] = {
      rps: load,
      latency: stats.latency,
      utilization: stats.utilization,
      errorRate: seen && seen.visits > 0 ? seen.errors / seen.visits : load > 0 ? stats.dropped / load : 0,
      backlog: stats.backlog,
      failed: stats.failed,
    }
    if (!stats.failed) maxUtilization = Math.max(maxUtilization, stats.utilization)
  }
  return {
    t,
    multiplier,
    rps: sim.totalRps,
    p50: percentileOf(sample.latencies, 50),
    p99: percentileOf(sample.latencies, 99),
    sloLatency: percentileOf(sample.latencies, sloPercentile),
    errorRate: sample.errorRate,
    burnRate: errorBudget > 0 ? sample.errorRate / errorBudget : 0,
    maxUtilization,
    backlog: sim.backlogRps,
    nodes,
  }
}
