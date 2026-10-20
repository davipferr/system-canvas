// Availability: the chance that a user's request succeeds, and which components it hinges on.
//
// The two rules every SLA calculation comes down to:
//
// * In SERIES (a request needs A and then B) availabilities multiply:
//     99.9% × 99.9% = 99.8%. Every extra hop on the critical path costs a little.
// * In PARALLEL (any one of several copies will do) the *downtimes* multiply:
//     1 − (1 − 99.5%)³ = 99.99999%. Redundancy buys nines fast.
//
// Applied here:
//
// * A component is its replicas in parallel, and its shards in series (all shards are needed).
// * A request walks the design like traffic does in `simulate`, ignoring async connections
//   (the user does not wait for them), so its success is built up from the clients down:
//     - a load balancer's targets are interchangeable copies: parallel;
//     - other routers send each request down exactly one connection: a weighted average;
//     - services, caches and stores call their dependencies independently: series, weighted
//       by the share of requests that actually take each connection (a cache hit never
//       touches the database behind it).
// * Reads and writes are worked out separately, because a request is one or the other: a read
//   that only needs the cache and a write that only needs the database never both fail.

import type { Design, DesignNode } from './design'
import { behaviorOf, edgeCarries, simulate, totalOf, type SimulationResult, type Traffic } from './simulate'

/** Kinds that are distributed by nature (anycast DNS, CDN edges, S3), never a single box. */
const DISTRIBUTED_BY_DESIGN = new Set(['dns', 'cdn', 'object-storage'])

/** Requests a single component may cost before it counts as a single point of failure. */
export const SPOF_THRESHOLD = 0.01

export interface AvailabilityResult {
  /** Fraction of all client requests that succeed. */
  system: number
  /** Availability of each component on its own (replicas and shards included). */
  component: Record<string, number>
  /** Chance that a request reaching this component succeeds, including what it depends on. */
  success: Record<string, number>
}

export interface SinglePointOfFailure {
  id: string
  /** Fraction of the requests that currently succeed which fail when this component is down. */
  impact: number
}

/** Chance that one instance is up, as a fraction (clients are always "up"). */
export function instanceAvailability(node: DesignNode): number {
  const percent = node.params.availability
  return percent === undefined ? 1 : percent / 100
}

/** Replicas in parallel, shards in series. */
export function componentAvailability(node: DesignNode): number {
  const one = instanceAvailability(node)
  const replicas = node.params.replicas ?? 1
  const shards = node.params.shards ?? 1
  return (1 - (1 - one) ** replicas) ** shards
}

export function analyzeAvailability(
  design: Design,
  options: { failed?: ReadonlySet<string>; sim?: SimulationResult } = {},
): AvailabilityResult {
  const failed = options.failed ?? new Set<string>()
  // Traffic shares come from the healthy design: failures change which requests succeed,
  // not what users ask for. The sim also tells us which edges are loops or async.
  const sim = options.sim ?? simulate(design)
  const byId = new Map(design.nodes.map((n) => [n.id, n]))

  const component: Record<string, number> = {}
  for (const node of design.nodes) component[node.id] = failed.has(node.id) ? 0 : componentAvailability(node)

  // Success chance of a read and of a write that reaches each component.
  const byType: Record<string, Traffic> = {}
  const resolve = (id: string): Traffic => {
    if (id in byType) return byType[id]
    const node = byId.get(id)!
    const edges = design.edges.filter((e) => e.from === id && !sim.edges[e.id].ignored && !sim.edges[e.id].async)
    const behavior = behaviorOf(node.kind)

    const forType = (type: keyof Traffic): number => {
      const paths = edges.filter((e) => edgeCarries(e)[type])
      if (paths.length === 0) return 1
      const handled = sim.nodes[id].served[type]
      // Share of this component's reads (or writes) that take each connection. With no
      // traffic to go on, assume each uses every connection (or one of them, for a router).
      const share = (edgeId: string) =>
        handled > 0 ? sim.edges[edgeId].traffic[type] / handled : behavior === 'split' ? 1 / paths.length : 1

      if (node.kind === 'load-balancer') {
        // Interchangeable targets: it only fails if every one of them does.
        return 1 - paths.reduce((p, e) => p * (1 - resolve(e.to)[type]), 1)
      }
      if (behavior === 'split') {
        // Each request takes exactly one path.
        const taken = paths.reduce((sum, e) => sum + share(e.id), 0)
        return 1 - taken + paths.reduce((sum, e) => sum + share(e.id) * resolve(e.to)[type], 0)
      }
      // Independent dependencies, each needed by the share of requests that call it.
      return paths.reduce((p, e) => p * (1 - share(e.id) + share(e.id) * resolve(e.to)[type]), 1)
    }

    const clamp = (x: number) => Math.min(1, Math.max(0, x))
    byType[id] = {
      reads: component[id] * clamp(forType('reads')),
      writes: component[id] * clamp(forType('writes')),
    }
    return byType[id]
  }
  for (const node of design.nodes) resolve(node.id)

  // Blend reads and writes by the traffic each component actually gets.
  const success: Record<string, number> = {}
  for (const node of design.nodes) {
    const load = sim.nodes[node.id].load
    const total = totalOf(load)
    const s = byType[node.id]
    success[node.id] = total > 0 ? (load.reads * s.reads + load.writes * s.writes) / total : (s.reads + s.writes) / 2
  }

  const clients = design.nodes.filter((n) => n.kind === 'client')
  const total = clients.reduce((sum, c) => sum + c.params.rps, 0)
  const system = total > 0 ? clients.reduce((sum, c) => sum + c.params.rps * success[c.id], 0) / total : 1

  return { system, component, success }
}

/** Single-instance components (not distributed by design) whose failure costs ≥ 1% of requests. */
export function isSingleInstance(node: DesignNode): boolean {
  if (node.kind === 'client' || DISTRIBUTED_BY_DESIGN.has(node.kind)) return false
  return (node.params.replicas ?? 1) <= 1
}

/**
 * What each component's failure would cost: the share of currently successful requests that
 * would fail. Components that are already down are skipped.
 */
export function failureImpact(design: Design, failed: ReadonlySet<string> = new Set()): Record<string, number> {
  const sim = simulate(design)
  const base = analyzeAvailability(design, { failed, sim }).system
  const impact: Record<string, number> = {}
  for (const node of design.nodes) {
    if (node.kind === 'client' || failed.has(node.id)) continue
    const without = analyzeAvailability(design, { failed: new Set([...failed, node.id]), sim }).system
    impact[node.id] = base > 0 ? Math.max(0, (base - without) / base) : 0
  }
  return impact
}

export function singlePointsOfFailure(
  design: Design,
  failed: ReadonlySet<string> = new Set(),
): SinglePointOfFailure[] {
  const impact = failureImpact(design, failed)
  return design.nodes
    .filter((node) => isSingleInstance(node) && (impact[node.id] ?? 0) >= SPOF_THRESHOLD)
    .map((node) => ({ id: node.id, impact: impact[node.id] }))
    .sort((a, b) => b.impact - a.impact)
}

/** Expected downtime per year, in hours, for an availability fraction. */
export function downtimePerYear(availability: number): number {
  return (1 - availability) * 365.25 * 24
}

/** "Three nines" and friends: -log10 of the failure probability. */
export function nines(availability: number): number {
  return availability >= 1 ? Infinity : -Math.log10(1 - availability)
}
