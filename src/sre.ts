// SRE view of a design: latency percentiles, error rates, SLOs and error budgets.
//
// The traffic model works with averages, but SLOs are written as percentiles ("99% of requests
// faster than 300 ms") and users feel the slow tail, not the mean. So here we follow sample
// requests one by one:
//
// * Each request is a read or a write, in the clients' proportions.
// * At every component it waits a random time drawn from the queueing model. For an M/M/1
//   queue the time spent is exponentially distributed with the mean `simulate` reports, so the
//   tail is exact per component: p99 = mean × ln(100) ≈ 4.6 × mean.
// * It takes connections with the same shares the traffic model computed: one load-balancer
//   target, a cache miss 20% of the time, the database only if it is a write...
// * It fails if it reaches a component that is down or turning requests away.
//
// A fixed seed makes the sample repeatable, so numbers only change when the design does.

import type { Design, DesignEdge } from './design'
import { behaviorOf, totalOf, type SimulationResult, type Traffic } from './simulate'

// ---- Sampling requests -------------------------------------------------------------------

export interface RequestSample {
  /** Requests simulated. */
  count: number
  /** Fraction that failed (reached a component that was down or dropping requests). */
  errorRate: number
  /** Latencies of the successful requests, in ms, sorted ascending. */
  latencies: number[]
  /**
   * Per component: sampled requests that passed through it, and how many of those failed there
   * or further down (what its callers would see as errors).
   */
  nodes: Record<string, { visits: number; errors: number }>
}

/** Exactly ln(100): the 99th percentile of an exponential distribution is 4.6× its mean. */
export const P99_FACTOR = Math.log(100)

/** Small, fast, seeded PRNG (mulberry32): same seed, same sequence. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function sampleRequests(
  design: Design,
  sim: SimulationResult,
  options: { count?: number; seed?: number } = {},
): RequestSample {
  const count = options.count ?? 20_000
  const rand = seededRandom(options.seed ?? 42)
  const byId = new Map(design.nodes.map((n) => [n.id, n]))
  const outs = new Map<string, DesignEdge[]>(design.nodes.map((n) => [n.id, []]))
  for (const edge of design.edges) {
    const stats = sim.edges[edge.id]
    if (!stats.ignored && !stats.async) outs.get(edge.from)!.push(edge)
  }

  const clients = design.nodes.filter((n) => n.kind === 'client' && totalOf(sim.nodes[n.id].load) > 0)
  const totalRps = clients.reduce((sum, c) => sum + totalOf(sim.nodes[c.id].load), 0)
  const nodes: RequestSample['nodes'] = Object.fromEntries(design.nodes.map((n) => [n.id, { visits: 0, errors: 0 }]))
  if (clients.length === 0 || totalRps === 0) return { count: 0, errorRate: 0, latencies: [], nodes }

  const exponential = (mean: number) => (mean > 0 ? -mean * Math.log(1 - rand()) : 0)

  /** Time to answer `type` at `id`, including the calls it makes; NaN when the request fails. */
  const visit = (id: string, type: keyof Traffic): number => {
    nodes[id].visits++
    const time = answer(id, type)
    if (Number.isNaN(time)) nodes[id].errors++
    return time
  }

  const answer = (id: string, type: keyof Traffic): number => {
    const stats = sim.nodes[id]
    const load = totalOf(stats.load)
    const lost = stats.failed ? load : stats.dropped
    if (load > 0 && lost > 0 && rand() < lost / load) return NaN

    let time = exponential(stats.latency)
    const handled = stats.served[type]
    if (handled <= 0) return time
    const edges = outs.get(id)!.filter((e) => sim.edges[e.id].traffic[type] > 0)
    if (edges.length === 0) return time

    if (behaviorOf(byId.get(id)!.kind) === 'split') {
      // Exactly one connection, chosen in proportion to the traffic each one carries.
      const total = edges.reduce((sum, e) => sum + sim.edges[e.id].traffic[type], 0)
      let pick = rand() * total
      const edge = edges.find((e) => (pick -= sim.edges[e.id].traffic[type]) <= 0) ?? edges[edges.length - 1]
      return time + visit(edge.to, type)
    }
    // Every connection this request needs, one after another (a cache miss, a write...).
    for (const edge of edges) {
      if (rand() < sim.edges[edge.id].traffic[type] / handled) time += visit(edge.to, type)
      if (Number.isNaN(time)) break // one failed dependency fails the whole request
    }
    return time
  }

  const latencies: number[] = []
  let errors = 0
  for (let i = 0; i < count; i++) {
    // Pick a client by its share of traffic, then read or write by its mix.
    let pick = rand() * totalRps
    const client = clients.find((c) => (pick -= totalOf(sim.nodes[c.id].load)) <= 0) ?? clients[clients.length - 1]
    const load = sim.nodes[client.id].load
    const type: keyof Traffic = rand() < load.reads / totalOf(load) ? 'reads' : 'writes'
    const time = visit(client.id, type)
    if (Number.isNaN(time)) errors++
    else latencies.push(time)
  }
  latencies.sort((a, b) => a - b)
  return { count, errorRate: errors / count, latencies, nodes }
}

/** The p-th percentile (0–100) of ascending values, by nearest rank. */
export function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]
}

/** Fraction of values at or below `threshold`. */
export function fractionAtOrBelow(sorted: number[], threshold: number): number {
  if (sorted.length === 0) return 1
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] <= threshold) lo = mid + 1
    else hi = mid
  }
  return lo / sorted.length
}

// ---- SLOs and error budgets -----------------------------------------------------------------

/** Service level objectives for a design. */
export interface Slo {
  /** Target share of successful requests, in percent (99.9 = "three nines"). */
  availability: number
  /** Latency objective: `latencyPercentile`% of requests faster than `latencyMs`. */
  latencyPercentile: number
  latencyMs: number
}

export const DEFAULT_SLO: Slo = { availability: 99.9, latencyPercentile: 99, latencyMs: 300 }
export const SLO_PERCENTILES = [50, 90, 95, 99, 99.9]

/** Error budgets are counted over a rolling 30-day window, as most SLOs are. */
export const SLO_WINDOW_DAYS = 30

export interface SloReport {
  /** Allowed failure fraction, e.g. 0.001 for 99.9%. */
  errorBudget: number
  /** The budget as downtime over the window, in minutes (99.9% → 43.2 min / 30 days). */
  budgetMinutes: number
  /** Long-run availability expected from component availabilities (no current incidents). */
  expectedAvailability: number
  /** Share of the budget that ordinary hardware failures use up on average (above 1 = SLO missed). */
  expectedBudgetUse: number
  /** Failure rate right now, from drops and components that are down. */
  currentErrorRate: number
  /** How many times faster than "sustainable" the budget is burning right now (1 = exactly on budget). */
  burnRate: number
  /** Hours until the whole window's budget is gone at the current burn rate (Infinity when not burning). */
  hoursToExhaustion: number
  latency: {
    p50: number
    p95: number
    p99: number
    /** Measured latency at the SLO's percentile. */
    atTarget: number
    /** Fraction of successful requests faster than the threshold. */
    fastFraction: number
    met: boolean
  }
  availabilityMet: boolean
}

export function evaluateSlo(
  slo: Slo,
  expectedAvailability: number,
  sample: Pick<RequestSample, 'errorRate' | 'latencies'>,
): SloReport {
  const errorBudget = 1 - slo.availability / 100
  const windowMinutes = SLO_WINDOW_DAYS * 24 * 60
  const burnRate = errorBudget > 0 ? sample.errorRate / errorBudget : Infinity
  const atTarget = percentileOf(sample.latencies, slo.latencyPercentile)
  return {
    errorBudget,
    budgetMinutes: errorBudget * windowMinutes,
    expectedAvailability,
    expectedBudgetUse: errorBudget > 0 ? (1 - expectedAvailability) / errorBudget : Infinity,
    currentErrorRate: sample.errorRate,
    burnRate,
    hoursToExhaustion: burnRate > 0 ? (SLO_WINDOW_DAYS * 24) / burnRate : Infinity,
    latency: {
      p50: percentileOf(sample.latencies, 50),
      p95: percentileOf(sample.latencies, 95),
      p99: percentileOf(sample.latencies, 99),
      atTarget,
      fastFraction: fractionAtOrBelow(sample.latencies, slo.latencyMs),
      met: sample.latencies.length > 0 && atTarget <= slo.latencyMs,
    },
    // Met when the hardware alone stays inside the target AND nothing is burning faster than allowed.
    availabilityMet: expectedAvailability >= slo.availability / 100 && burnRate <= 1,
  }
}

/**
 * A valid SLO from anything (an imported file): numbers clamped to sensible ranges, the
 * percentile snapped to one of the supported ones, defaults for whatever is missing.
 */
export function normalizeSlo(raw: unknown): Slo {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const num = (key: keyof Slo, min: number, max: number) => {
    const v = value[key]
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : DEFAULT_SLO[key]
  }
  const percentile = num('latencyPercentile', 50, 99.9)
  return {
    availability: num('availability', 90, 99.999),
    latencyPercentile: SLO_PERCENTILES.reduce((best, p) =>
      Math.abs(p - percentile) < Math.abs(best - percentile) ? p : best,
    ),
    latencyMs: Math.round(num('latencyMs', 1, 60_000)),
  }
}
