// Distributed tracing: follow ONE request through the design and record a span for every
// component it touches, with when it started and how long it took. A waterfall of spans shows
// what a dashboard of averages cannot: the order of the calls, which hop the time went to, and
// the work that carries on after the user already has an answer.
//
// The rules match `sampleRequests` (same connection choices, same random waits), so a trace is
// one concrete example of the requests behind the percentiles:
// * A component does its own work first, then calls its dependencies one after another.
// * A synchronous call is waited for. An async one (a queue's consumers, connections labelled
//   async/events) starts a "follows-from" span that runs on its own, after the response is sent.
// * A component that is down or turning requests away fails its span, and every caller that
//   was waiting for it fails too. Failures in async work never reach the user.

import type { Design, DesignEdge } from './design'
import { behaviorOf, totalOf, type SimulationResult, type Traffic } from './simulate'
import { percentileOf, seededRandom } from './sre'

export interface Span {
  id: string
  nodeId: string
  parentId: string | null
  /** ms since the request started. */
  start: number
  /** ms from start until it answered, including the calls it waited for. */
  duration: number
  /** ms spent in the component itself (queueing and processing), not in its calls. */
  self: number
  /** Off the request's critical path: the user does not wait for it. */
  async: boolean
  error: boolean
  /** Nesting level, for indenting the waterfall. */
  depth: number
}

export interface Trace {
  /** A made-up 16-hex-digit id, like real tracing systems print. */
  id: string
  clientId: string
  type: keyof Traffic
  /** In call order: every span comes after its parent. */
  spans: Span[]
  /** What the user waited: the root span's duration. */
  duration: number
  /** When the last span (async work included) finished. */
  end: number
  error: boolean
}

export type TracePick = 'random' | 'typical' | 'slow' | 'error'

export function generateTrace(
  design: Design,
  sim: SimulationResult,
  options: { type?: keyof Traffic; clientId?: string; seed?: number } = {},
): Trace | null {
  const seed = options.seed ?? 1
  const rand = seededRandom(seed)
  const byId = new Map(design.nodes.map((n) => [n.id, n]))
  const outs = new Map<string, DesignEdge[]>(design.nodes.map((n) => [n.id, []]))
  for (const edge of design.edges) if (!sim.edges[edge.id].ignored) outs.get(edge.from)!.push(edge)

  const clients = design.nodes.filter(
    (n) => n.kind === 'client' && totalOf(sim.nodes[n.id].load) > 0 && (!options.clientId || n.id === options.clientId),
  )
  if (clients.length === 0) return null
  const totalRps = clients.reduce((sum, c) => sum + totalOf(sim.nodes[c.id].load), 0)
  let pick = rand() * totalRps
  const client = clients.find((c) => (pick -= totalOf(sim.nodes[c.id].load)) <= 0) ?? clients[clients.length - 1]
  const load = sim.nodes[client.id].load
  const type: keyof Traffic = options.type ?? (rand() < load.reads / totalOf(load) ? 'reads' : 'writes')
  if (load[type] <= 0) return null

  const exponential = (mean: number) => (mean > 0 ? -mean * Math.log(1 - rand()) : 0)
  const spans: Span[] = []

  const visit = (nodeId: string, parentId: string | null, start: number, async: boolean, depth: number) => {
    const span: Span = { id: `span-${spans.length + 1}`, nodeId, parentId, start, duration: 0, self: 0, async, error: false, depth }
    spans.push(span)
    const stats = sim.nodes[nodeId]
    const offered = totalOf(stats.load)
    const lost = stats.failed ? offered : stats.dropped
    if (stats.failed || (offered > 0 && lost > 0 && rand() < lost / offered)) {
      span.error = true
      return { end: start, error: true }
    }

    span.self = exponential(stats.latency)
    let cursor = start + span.self
    let error = false
    const handled = stats.served[type]
    const edges = handled > 0 ? outs.get(nodeId)!.filter((e) => sim.edges[e.id].traffic[type] > 0) : []

    let chosen: DesignEdge[]
    if (edges.length > 0 && behaviorOf(byId.get(nodeId)!.kind) === 'split') {
      const total = edges.reduce((sum, e) => sum + sim.edges[e.id].traffic[type], 0)
      let r = rand() * total
      chosen = [edges.find((e) => (r -= sim.edges[e.id].traffic[type]) <= 0) ?? edges[edges.length - 1]]
    } else {
      chosen = edges.filter((e) => rand() < sim.edges[e.id].traffic[type] / handled)
    }

    for (const edge of chosen) {
      if (sim.edges[edge.id].async) {
        // Fire and forget: it starts now but nobody waits for it, and its failures stay with it.
        visit(edge.to, span.id, cursor, true, depth + 1)
        continue
      }
      const call = visit(edge.to, span.id, cursor, async, depth + 1)
      cursor = call.end
      if (call.error) {
        error = true
        break // the request has failed; the remaining calls never happen
      }
    }
    span.duration = cursor - start
    span.error = error
    return { end: cursor, error }
  }

  const root = visit(client.id, null, 0, false, 0)
  const hex = (n: number) => Math.floor(n * 0xffffffff).toString(16).padStart(8, '0')
  return {
    id: hex(seededRandom(seed * 7919)()) + hex(seededRandom(seed * 104729)()),
    clientId: client.id,
    type,
    spans,
    duration: root.end,
    end: Math.max(...spans.map((s) => s.start + s.duration)),
    error: root.error,
  }
}

/**
 * An exemplar: generate many traces and return a representative one. "typical" is the median
 * successful request, "slow" the p99 one (what you open when the latency SLO alert fires),
 * "error" the first failed one, "random" just the first.
 */
export function pickTrace(
  design: Design,
  sim: SimulationResult,
  options: { pick: TracePick; type?: keyof Traffic; clientId?: string; seed?: number; count?: number },
): Trace | null {
  const count = options.count ?? 200
  const seed = options.seed ?? 1
  const traces: Trace[] = []
  for (let i = 0; i < count; i++) {
    const trace = generateTrace(design, sim, { type: options.type, clientId: options.clientId, seed: seed + i })
    if (trace) traces.push(trace)
    if (options.pick === 'random' && trace) return trace
    if (options.pick === 'error' && trace?.error) return trace
  }
  if (options.pick === 'error' || traces.length === 0) return null
  const ok = traces.filter((t) => !t.error).sort((a, b) => a.duration - b.duration)
  if (ok.length === 0) return traces[0]
  const target = percentileOf(
    ok.map((t) => t.duration),
    options.pick === 'slow' ? 99 : 50,
  )
  return ok.find((t) => t.duration === target)!
}

/** Where the user's wait went: self time of each component on the critical path, largest first. */
export function timeBreakdown(trace: Trace): { nodeId: string; self: number; share: number }[] {
  const byNode = new Map<string, number>()
  for (const span of trace.spans) {
    if (span.async) continue
    byNode.set(span.nodeId, (byNode.get(span.nodeId) ?? 0) + span.self)
  }
  return [...byNode]
    .map(([nodeId, self]) => ({ nodeId, self, share: trace.duration > 0 ? self / trace.duration : 0 }))
    .filter((row) => row.self > 0)
    .sort((a, b) => b.self - a.self)
}
