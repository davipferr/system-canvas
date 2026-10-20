import { describe, expect, it } from 'vitest'
import {
  addNode,
  connect,
  createDesign,
  DEFAULT_SLO,
  evaluateSlo,
  fractionAtOrBelow,
  normalizeSlo,
  P99_FACTOR,
  parseDesign,
  percentileOf,
  sampleRequests,
  serializeDesign,
  setSlo,
  simulate,
  type ComponentKind,
  type Design,
} from 'system-canvas'
import { sampleDesign } from '../playground/sample'

type NodeDef = [id: string, kind: ComponentKind, params?: Record<string, number>]

function build(nodes: NodeDef[], edges: [string, string, string?][] = []): Design {
  let d = createDesign()
  nodes.forEach(([id, kind, params], i) => {
    d = addNode(d, kind, { x: i * 200, y: 0 }, { id, params }).design
  })
  for (const [from, to, label] of edges) d = connect(d, from, to, { label }).design
  return d
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

describe('percentiles', () => {
  it('uses nearest rank', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentileOf(xs, 50)).toBe(5)
    expect(percentileOf(xs, 90)).toBe(9)
    expect(percentileOf(xs, 99)).toBe(10)
    expect(percentileOf([], 99)).toBe(0)
  })

  it('counts the share at or below a threshold', () => {
    expect(fractionAtOrBelow([1, 2, 3, 4], 2)).toBe(0.5)
    expect(fractionAtOrBelow([1, 2, 3, 4], 0)).toBe(0)
    expect(fractionAtOrBelow([1, 2, 3, 4], 9)).toBe(1)
  })
})

describe('sampleRequests', () => {
  // One M/M/1 server at 50% busy: mean time 30 / (1 − 0.5) = 60 ms, exponentially distributed.
  const single = () =>
    build(
      [
        ['u', 'client', { rps: 1000 }],
        ['api', 'service', { latency: 30, capacity: 500, replicas: 4 }],
      ],
      [['u', 'api']],
    )

  it('reproduces the exponential tail of a queue', () => {
    const d = single()
    const s = sampleRequests(d, simulate(d))
    expect(s.errorRate).toBe(0)
    expect(mean(s.latencies)).toBeCloseTo(60, -0.5) // within ~2 ms
    expect(percentileOf(s.latencies, 50) / (60 * Math.LN2)).toBeCloseTo(1, 1)
    expect(percentileOf(s.latencies, 99) / (60 * P99_FACTOR)).toBeCloseTo(1, 1)
  })

  it('is repeatable for a given seed', () => {
    const d = single()
    const sim = simulate(d)
    expect(sampleRequests(d, sim, { seed: 7 })).toEqual(sampleRequests(d, sim, { seed: 7 }))
    expect(sampleRequests(d, sim, { seed: 7 }).latencies).not.toEqual(sampleRequests(d, sim, { seed: 8 }).latencies)
  })

  it('averages to the response time the traffic model reports, on a real design', () => {
    const d = sampleDesign()
    const sim = simulate(d)
    const s = sampleRequests(d, sim, { count: 40_000 })
    expect(mean(s.latencies) / sim.responseTime).toBeCloseTo(1, 1)
  })

  it('only sends cache misses to the database', () => {
    const d = build(
      [
        ['u', 'client', { rps: 1000, readRatio: 100 }],
        ['cache', 'cache', { latency: 1, hitRate: 80 }],
        ['db', 'sql-db', { latency: 50, capacity: 50_000 }],
      ],
      [
        ['u', 'cache'],
        ['cache', 'db'],
      ],
    )
    const s = sampleRequests(d, simulate(d))
    // About 80% are fast hits; the slow 20% paid for the database.
    expect(fractionAtOrBelow(s.latencies, 10)).toBeGreaterThan(0.75)
    expect(fractionAtOrBelow(s.latencies, 10)).toBeLessThan(0.85)
  })

  it('counts requests that hit an overloaded or failed component as errors', () => {
    const overloaded = build(
      [
        ['u', 'client', { rps: 2000 }],
        ['api', 'service', { capacity: 500, replicas: 2 }],
      ],
      [['u', 'api']],
    )
    expect(sampleRequests(overloaded, simulate(overloaded)).errorRate).toBeCloseTo(0.5, 1)

    const d = single()
    expect(sampleRequests(d, simulate(d, { failed: new Set(['api']) })).errorRate).toBe(1)
  })

  it('charges a dependency failure to every caller on the way up', () => {
    const d = build(
      [
        ['u', 'client', { rps: 1000, readRatio: 80 }],
        ['api', 'service', { capacity: 1000, replicas: 2 }],
        ['cache', 'cache'],
        ['db', 'sql-db'],
      ],
      [
        ['u', 'api'],
        ['api', 'cache', 'reads'],
        ['api', 'db', 'writes'],
      ],
    )
    const s = sampleRequests(d, simulate(d, { failed: new Set(['db']) }))
    const rate = (id: string) => s.nodes[id].errors / s.nodes[id].visits
    expect(rate('db')).toBe(1)
    expect(rate('api')).toBeCloseTo(0.2, 1) // the writes: the API returns them as errors
    expect(rate('cache')).toBe(0)
    expect(s.errorRate).toBeCloseTo(0.2, 1)
  })

  it('leaves async work out of the latency', () => {
    const d = build(
      [
        ['u', 'client', { rps: 100 }],
        ['api', 'service', { latency: 10 }],
        ['q', 'queue', { latency: 1 }],
        ['w', 'worker', { latency: 5_000 }],
      ],
      [
        ['u', 'api'],
        ['api', 'q'],
        ['q', 'w'],
      ],
    )
    const s = sampleRequests(d, simulate(d))
    expect(percentileOf(s.latencies, 99)).toBeLessThan(200)
  })

  it('returns an empty sample without traffic', () => {
    const d = build([['api', 'service']])
    expect(sampleRequests(d, simulate(d))).toEqual({
      count: 0,
      errorRate: 0,
      latencies: [],
      nodes: { api: { visits: 0, errors: 0 } },
    })
  })
})

describe('SLOs', () => {
  it('turns an availability target into an error budget', () => {
    const r = evaluateSlo(DEFAULT_SLO, 0.9995, { errorRate: 0, latencies: [100] })
    expect(r.errorBudget).toBeCloseTo(0.001)
    expect(r.budgetMinutes).toBeCloseTo(43.2) // 0.1% of 30 days
    expect(r.expectedBudgetUse).toBeCloseTo(0.5) // hardware failures use half of it
    expect(r.burnRate).toBe(0)
    expect(r.hoursToExhaustion).toBe(Infinity)
    expect(r.availabilityMet).toBe(true)
  })

  it('measures the burn rate of a live incident', () => {
    // 1% of requests failing against a 0.1% budget: burning 10× too fast, gone in 3 days.
    const r = evaluateSlo(DEFAULT_SLO, 0.9999, { errorRate: 0.01, latencies: [100] })
    expect(r.burnRate).toBeCloseTo(10)
    expect(r.hoursToExhaustion).toBeCloseTo(72)
    expect(r.availabilityMet).toBe(false)
  })

  it('checks the latency objective at its percentile', () => {
    const latencies = Array.from({ length: 100 }, (_, i) => i + 1) // 1..100 ms
    const slo = { availability: 99.9, latencyPercentile: 95, latencyMs: 90 }
    const r = evaluateSlo(slo, 1, { errorRate: 0, latencies })
    expect(r.latency.atTarget).toBe(95)
    expect(r.latency.fastFraction).toBe(0.9)
    expect(r.latency.met).toBe(false)
    expect(evaluateSlo({ ...slo, latencyMs: 95 }, 1, { errorRate: 0, latencies }).latency.met).toBe(true)
  })

  it('is stored on the design, survives JSON and is validated on import', () => {
    const d = setSlo(createDesign(), { availability: 99.95, latencyPercentile: 95, latencyMs: 200 })
    expect(parseDesign(serializeDesign(d)).slo).toEqual({ availability: 99.95, latencyPercentile: 95, latencyMs: 200 })
    expect(normalizeSlo({ availability: 120, latencyPercentile: 97, latencyMs: -5 })).toEqual({
      availability: 99.999,
      latencyPercentile: 95,
      latencyMs: 1,
    })
    expect(normalizeSlo('nonsense')).toEqual(DEFAULT_SLO)
    expect('slo' in parseDesign({ version: 1, nodes: [], edges: [] })).toBe(false)
  })
})
