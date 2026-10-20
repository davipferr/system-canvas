// Checkable requirements for a design: the heart of the challenges. A challenge fixes the
// traffic (so lowering it is not a way to win) and lists the goals; `evaluateGoals` reports
// each one as passed or failed with the measured value next to the target.

import { analyzeAvailability, failureImpact, isSingleInstance, SPOF_THRESHOLD } from './availability'
import { catalog, type ComponentKind } from './catalog'
import { monthlyCost } from './cost'
import type { Design } from './design'
import { simulate, totalOf } from './simulate'

export interface Goals {
  /** Total requests per second the clients send, shared evenly between them. */
  rps: number
  /** Percentage of requests that are reads. */
  readRatio: number
  /** Average response time users see, in ms. */
  maxResponseTime?: number
  /** Fraction of requests that must succeed, e.g. 0.999. */
  minAvailability?: number
  /** No component turns requests away. */
  noDrops?: boolean
  /** No queue grows without bound. */
  noBacklog?: boolean
  /** No single points of failure. */
  noSpof?: boolean
  /** Monthly cost limit in dollars. */
  maxCost?: number
  /** Every component stays at or below this utilization (headroom for spikes). */
  maxUtilization?: number
  /** Kinds of component the design must use. */
  requires?: ComponentKind[]
}

export interface GoalResult {
  id: string
  label: string
  passed: boolean
  /** The measured value, formatted. */
  actual: string
}

/** The design with its clients sending exactly the challenge's traffic. */
export function applyTraffic(design: Design, rps: number, readRatio: number): Design {
  const clients = design.nodes.filter((n) => n.kind === 'client').length
  if (clients === 0) return design
  return {
    ...design,
    nodes: design.nodes.map((node) =>
      node.kind === 'client' ? { ...node, params: { ...node.params, rps: rps / clients, readRatio } } : node,
    ),
  }
}

const ms = (value: number) => `${Math.round(value)} ms`
const pct = (fraction: number, digits = 0) => `${(fraction * 100).toFixed(digits)}%`
/** Rounded down, so 99.9996% never shows as a perfect 100%. */
const availabilityPct = (fraction: number) => `${(Math.floor(fraction * 100_000) / 1000).toFixed(3)}%`
const rps = (value: number) => `${Math.round(value).toLocaleString('en-US')} rps`
const dollars = (value: number) => `$${Math.round(value).toLocaleString('en-US')}`

export function evaluateGoals(design: Design, goals: Goals): { passed: boolean; results: GoalResult[] } {
  const loaded = applyTraffic(design, goals.rps, goals.readRatio)
  const sim = simulate(loaded)
  const results: GoalResult[] = []
  const hasClient = loaded.nodes.some((n) => n.kind === 'client')

  results.push({
    id: 'client',
    label: 'Has a client sending traffic',
    passed: hasClient,
    actual: hasClient ? rps(sim.totalRps) : 'no client',
  })

  if (goals.noDrops) {
    results.push({
      id: 'noDrops',
      label: `Serves all ${rps(goals.rps)} without dropping any`,
      passed: hasClient && sim.droppedRps < 0.5,
      actual: sim.droppedRps < 0.5 ? 'nothing dropped' : `${rps(sim.droppedRps)} dropped`,
    })
  }
  if (goals.noBacklog) {
    results.push({
      id: 'noBacklog',
      label: 'Queues keep up (no growing backlog)',
      passed: sim.backlogRps < 0.5,
      actual: sim.backlogRps < 0.5 ? 'no backlog' : `+${rps(sim.backlogRps)} backlog`,
    })
  }
  if (goals.maxResponseTime !== undefined) {
    results.push({
      id: 'maxResponseTime',
      label: `Average response time under ${ms(goals.maxResponseTime)}`,
      passed: hasClient && sim.responseTime <= goals.maxResponseTime,
      actual: ms(sim.responseTime),
    })
  }
  if (goals.maxUtilization !== undefined) {
    const busiest = sim.bottleneck ? sim.nodes[sim.bottleneck].utilization : 0
    const name = loaded.nodes.find((n) => n.id === sim.bottleneck)?.label
    results.push({
      id: 'maxUtilization',
      label: `Every component at most ${pct(goals.maxUtilization)} busy`,
      passed: busiest <= goals.maxUtilization,
      actual: name ? `${name} at ${pct(busiest)}` : 'idle',
    })
  }
  if (goals.minAvailability !== undefined) {
    const availability = analyzeAvailability(loaded, { sim }).system
    results.push({
      id: 'minAvailability',
      label: `Availability of at least ${pct(goals.minAvailability, 2)}`,
      passed: hasClient && availability >= goals.minAvailability,
      actual: availabilityPct(availability),
    })
  }
  if (goals.noSpof) {
    const impact = failureImpact(loaded)
    const spofs = loaded.nodes.filter((n) => isSingleInstance(n) && (impact[n.id] ?? 0) >= SPOF_THRESHOLD)
    results.push({
      id: 'noSpof',
      label: 'No single points of failure',
      passed: spofs.length === 0,
      actual: spofs.length === 0 ? 'none' : spofs.map((n) => n.label).join(', '),
    })
  }
  if (goals.maxCost !== undefined) {
    const cost = monthlyCost(loaded)
    results.push({
      id: 'maxCost',
      label: `Costs at most ${dollars(goals.maxCost)} a month`,
      passed: cost <= goals.maxCost,
      actual: dollars(cost),
    })
  }
  for (const kind of goals.requires ?? []) {
    const used = loaded.nodes.some((n) => n.kind === kind && totalOf(sim.nodes[n.id].load) > 0)
    results.push({
      id: `requires:${kind}`,
      label: `Uses a ${catalog[kind].label.toLowerCase()} that gets traffic`,
      passed: used,
      actual: used ? 'yes' : 'no',
    })
  }

  return { passed: results.every((r) => r.passed), results }
}
