// Game day: a hidden fault is injected into the design and the player has to notice it, find
// it with the dashboards, alerts and traces, and fix it. Teams run these drills for real to
// practise incident response before a real incident does it for them.
//
// Everything here is pure: which faults could hit a design, what each one does to it, whether
// it actually hurts (a fault nobody can see is no game), and how the incident is scored.

import { catalog } from './catalog'
import type { Design } from './design'
import { scaleTraffic, simulate, totalOf } from './simulate'
import { percentileOf, sampleRequests, seededRandom, type Slo } from './sre'
import type { MetricPoint } from './timeline'

export type FaultType = 'crash' | 'slow' | 'capacity' | 'cache-flush' | 'spike'

export interface Fault {
  type: FaultType
  /** The component hit, or null for a traffic spike. */
  target: string | null
}

export const FAULT_TYPES: Record<
  FaultType,
  { label: string; guess: string; remedy: string; explanation: string; lesson: string }
> = {
  crash: {
    label: 'Crash',
    guess: 'It is down',
    remedy: 'Restart it',
    explanation: 'The component crashed and stopped answering.',
    lesson: 'A crash shows up as errors at its callers. A single instance has nothing to fail over to: replicas behind a load balancer turn a crash into a non-event.',
  },
  slow: {
    label: 'Slow dependency',
    guess: 'It got slow',
    remedy: 'Roll back the bad deploy',
    explanation: 'A bad deploy made it 8× slower.',
    lesson: 'Slowness hides in averages but jumps out of traces: one span suddenly takes most of the request. Timeouts and rollbacks are the usual cure.',
  },
  capacity: {
    label: 'Lost capacity',
    guess: 'It lost capacity',
    remedy: 'Roll back and scale out',
    explanation: 'It lost 70% of its capacity (failed hosts, a noisy neighbour, a bad config).',
    lesson: 'Lost capacity shows up as saturation first, then queueing latency, then drops. Headroom is what buys you time.',
  },
  'cache-flush': {
    label: 'Cache flushed',
    guess: 'Its cache stopped helping',
    remedy: 'Warm the cache back up',
    explanation: 'The cache was flushed: its hit rate fell to 10% and the misses landed on what is behind it.',
    lesson: 'A cache failure looks like a database problem: the symptom appears one hop downstream. Size the database to survive a cold cache.',
  },
  spike: {
    label: 'Traffic spike',
    guess: 'Traffic spiked',
    remedy: 'Turn on rate limiting',
    explanation: 'Traffic suddenly tripled: a viral post, a retry storm, a bot.',
    lesson: 'Nothing is broken, there is just too much. The traffic chart tells you first. Autoscaling, load shedding and rate limits are the defences.',
  },
}

/** Simulated minutes a remedy takes to roll out. */
export const REMEDY_MINUTES = 5
/** Healthy minutes in a row before an incident counts as resolved. */
export const RECOVERY_HOLD_MINUTES = 5
/** Each wrong diagnosis adds this many minutes to the time to detect. */
export const WRONG_GUESS_PENALTY = 5

const FAULT_SLOWDOWN = 8
const FAULT_CAPACITY_LEFT = 0.3
const FAULT_HIT_RATE = 10
const FAULT_SPIKE = 3

/** Every fault that could hit this design: one per component and kind that applies, plus a spike. */
export function faultCandidates(design: Design, liveTraffic?: (id: string) => number): Fault[] {
  const faults: Fault[] = []
  for (const node of design.nodes) {
    if (node.kind === 'client') continue
    if (liveTraffic && liveTraffic(node.id) <= 0) continue
    const params = catalog[node.kind].params.map((p) => p.key)
    faults.push({ type: 'crash', target: node.id })
    if (params.includes('latency')) faults.push({ type: 'slow', target: node.id })
    if (params.includes('capacity')) faults.push({ type: 'capacity', target: node.id })
    if (params.includes('hitRate')) faults.push({ type: 'cache-flush', target: node.id })
  }
  faults.push({ type: 'spike', target: null })
  return faults
}

/** The design as the fault leaves it, plus components it takes down and traffic it adds. */
export function applyFault(design: Design, fault: Fault): { design: Design; failed: string[]; trafficMultiplier: number } {
  if (fault.type === 'spike') return { design, failed: [], trafficMultiplier: FAULT_SPIKE }
  if (fault.type === 'crash') return { design, failed: fault.target ? [fault.target] : [], trafficMultiplier: 1 }
  const nodes = design.nodes.map((node) => {
    if (node.id !== fault.target) return node
    const p = { ...node.params }
    if (fault.type === 'slow') p.latency = (p.latency ?? 0) * FAULT_SLOWDOWN
    if (fault.type === 'capacity') p.capacity = (p.capacity ?? 0) * FAULT_CAPACITY_LEFT
    if (fault.type === 'cache-flush') p.hitRate = FAULT_HIT_RATE
    return { ...node, params: p }
  })
  return { design: { ...design, nodes }, failed: [], trafficMultiplier: 1 }
}

/** Is this moment within the SLOs? Budget burning no faster than allowed, latency on target. */
export function isHealthy(point: MetricPoint, slo: Slo): boolean {
  return point.burnRate <= 1 && point.sloLatency <= slo.latencyMs
}

/** How badly a fault would hurt the design right now: burn rate and latency vs the SLO target. */
export function faultHarm(design: Design, fault: Fault, slo: Slo, failed: ReadonlySet<string> = new Set()) {
  const hit = applyFault(design, fault)
  const loaded = hit.trafficMultiplier === 1 ? hit.design : scaleTraffic(hit.design, hit.trafficMultiplier)
  const sim = simulate(loaded, { failed: new Set([...failed, ...hit.failed]) })
  const sample = sampleRequests(loaded, sim, { count: 3000, seed: 5 })
  const budget = 1 - slo.availability / 100
  return {
    burnRate: budget > 0 ? sample.errorRate / budget : 0,
    latencyRatio: slo.latencyMs > 0 ? percentileOf(sample.latencies, slo.latencyPercentile) / slo.latencyMs : 0,
  }
}

/**
 * A random fault that would visibly break the SLOs (burning the budget at least 2× too fast,
 * or latency 20% over target), or null if the design shrugs off every one of them.
 */
export function pickFault(
  design: Design,
  slo: Slo,
  seed: number,
  failed: ReadonlySet<string> = new Set(),
): Fault | null {
  const live = simulate(design, { failed })
  const candidates = faultCandidates(design, (id) => totalOf(live.nodes[id].load))
  const harmful = candidates.filter((fault) => {
    const harm = faultHarm(design, fault, slo, failed)
    return harm.burnRate >= 2 || harm.latencyRatio >= 1.2
  })
  if (harmful.length === 0) return null
  return harmful[Math.floor(seededRandom(seed)() * harmful.length)]
}

/**
 * When the incident ended: the start of the first run of healthy points, at least
 * `RECOVERY_HOLD_MINUTES` long, after the system was first seen unhealthy following the fault.
 * Null while it is still broken (or has not visibly broken yet).
 */
export function recoveredAt(points: MetricPoint[], faultAt: number, slo: Slo): number | null {
  const after = points.filter((p) => p.t >= faultAt)
  const firstBad = after.findIndex((p) => !isHealthy(p, slo))
  if (firstBad < 0) return null
  let streakStart: number | null = null
  for (const point of after.slice(firstBad)) {
    if (!isHealthy(point, slo)) {
      streakStart = null
      continue
    }
    streakStart ??= point.t
    if (point.t - streakStart >= RECOVERY_HOLD_MINUTES) return streakStart
  }
  return null
}

/** First moment the system was seen unhealthy after the fault: when users started to hurt. */
export function impactStartedAt(points: MetricPoint[], faultAt: number, slo: Slo): number | null {
  return points.find((p) => p.t >= faultAt && !isHealthy(p, slo))?.t ?? null
}

/**
 * Share of a whole SLO window's error budget the incident used: failed requests during it,
 * relative to the failures the budget allows over `windowDays`.
 */
export function budgetUsed(points: MetricPoint[], from: number, to: number, slo: Slo, windowDays = 30): number {
  const budget = 1 - slo.availability / 100
  if (budget <= 0) return 0
  let failedMinutes = 0
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    if (b.t <= from || a.t >= to) continue
    const dt = Math.min(b.t, to) - Math.max(a.t, from)
    // A scraped value holds until the next sample, so each interval uses its starting point.
    failedMinutes += Math.max(0, dt) * a.errorRate
  }
  return failedMinutes / (budget * windowDays * 24 * 60)
}

/** A one-word verdict on time to recover, in simulated minutes. */
export function recoveryGrade(minutes: number): { grade: string; note: string } {
  if (minutes <= 15) return { grade: 'Excellent', note: 'Recovered within a quarter of an hour.' }
  if (minutes <= 30) return { grade: 'Good', note: 'Recovered within half an hour.' }
  if (minutes <= 60) return { grade: 'Okay', note: 'Recovered within the hour. Better alerts or dashboards would shorten the search.' }
  return { grade: 'Rough', note: 'Over an hour. Look at which signal pointed to the cause, and alert on it.' }
}
