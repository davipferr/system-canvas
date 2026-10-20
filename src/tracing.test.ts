import { describe, expect, it } from 'vitest'
import {
  addNode,
  connect,
  createDesign,
  generateTrace,
  pickTrace,
  simulate,
  timeBreakdown,
  type ComponentKind,
  type Design,
  type Trace,
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

const span = (trace: Trace, nodeId: string) => trace.spans.find((s) => s.nodeId === nodeId)!

/** client → api → db, plus api → queue → worker (async) */
const app = () =>
  build(
    [
      ['u', 'client', { rps: 100, readRatio: 0 }],
      ['api', 'service', { latency: 20 }],
      ['db', 'sql-db', { latency: 10 }],
      ['q', 'queue', { latency: 2 }],
      ['w', 'worker', { latency: 300 }],
    ],
    [
      ['u', 'api'],
      ['api', 'db'],
      ['api', 'q'],
      ['q', 'w'],
    ],
  )

describe('generateTrace', () => {
  it('nests spans: own work first, then each call in turn', () => {
    const d = app()
    const t = generateTrace(d, simulate(d), { seed: 3 })!
    expect(t.spans.map((s) => s.nodeId)).toEqual(['u', 'api', 'db', 'q', 'w'])
    const [api, db, q] = [span(t, 'api'), span(t, 'db'), span(t, 'q')]
    expect(api.parentId).toBe(span(t, 'u').id)
    expect(db.start).toBeCloseTo(api.start + api.self)
    expect(q.start).toBeCloseTo(db.start + db.duration)
    expect(api.duration).toBeCloseTo(api.self + db.duration + q.duration)
    expect(t.duration).toBeCloseTo(span(t, 'u').duration)
  })

  it('keeps async work off the critical path', () => {
    const d = app()
    const t = generateTrace(d, simulate(d), { seed: 3 })!
    const worker = span(t, 'w')
    expect(worker.async).toBe(true)
    expect(span(t, 'q').async).toBe(false)
    expect(worker.start).toBeCloseTo(span(t, 'q').start + span(t, 'q').self)
    // The user's wait does not include the worker, but the trace runs on until it is done.
    expect(t.duration).toBeLessThan(worker.start + worker.duration)
    expect(t.end).toBeCloseTo(worker.start + worker.duration)
  })

  it('fails the span and every caller that waited for it', () => {
    const d = app()
    const t = generateTrace(d, simulate(d, { failed: new Set(['db']) }), { seed: 3 })!
    expect(t.error).toBe(true)
    expect(span(t, 'db').error).toBe(true)
    expect(span(t, 'api').error).toBe(true)
    // The request failed at the database, so the API never got as far as the queue.
    expect(t.spans.some((s) => s.nodeId === 'q')).toBe(false)
  })

  it('does not fail the request when only async work fails', () => {
    const d = app()
    const t = generateTrace(d, simulate(d, { failed: new Set(['w']) }), { seed: 3 })!
    expect(span(t, 'w').error).toBe(true)
    expect(t.error).toBe(false)
  })

  it('only sends cache misses on to the database', () => {
    const d = build(
      [
        ['u', 'client', { rps: 100, readRatio: 100 }],
        ['cache', 'cache', { hitRate: 80 }],
        ['db', 'sql-db'],
      ],
      [
        ['u', 'cache'],
        ['cache', 'db'],
      ],
    )
    const sim = simulate(d)
    let misses = 0
    for (let seed = 1; seed <= 1000; seed++) {
      if (generateTrace(d, sim, { seed })!.spans.some((s) => s.nodeId === 'db')) misses++
    }
    expect(misses / 1000).toBeCloseTo(0.2, 1)
  })

  it('agrees with the traffic model on average', () => {
    const d = sampleDesign()
    const sim = simulate(d)
    let total = 0
    const n = 4000
    for (let seed = 1; seed <= n; seed++) total += generateTrace(d, sim, { seed })!.duration
    expect(total / n / sim.responseTime).toBeCloseTo(1, 1)
  })

  it('is repeatable for a seed and gives traces an id', () => {
    const d = app()
    const sim = simulate(d)
    expect(generateTrace(d, sim, { seed: 9 })).toEqual(generateTrace(d, sim, { seed: 9 }))
    expect(generateTrace(d, sim, { seed: 9 })!.id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('returns null without matching traffic', () => {
    const d = app() // writes only
    expect(generateTrace(d, simulate(d), { type: 'reads' })).toBeNull()
    expect(generateTrace(createDesign(), simulate(createDesign()))).toBeNull()
  })
})

describe('pickTrace', () => {
  it('finds typical, slow and failing exemplars', () => {
    const d = app()
    const sim = simulate(d)
    const typical = pickTrace(d, sim, { pick: 'typical' })!
    const slow = pickTrace(d, sim, { pick: 'slow' })!
    expect(slow.duration).toBeGreaterThan(typical.duration)
    expect(pickTrace(d, sim, { pick: 'error' })).toBeNull() // nothing is failing

    const broken = simulate(d, { failed: new Set(['db']) })
    expect(pickTrace(d, broken, { pick: 'error' })!.error).toBe(true)
  })
})

describe('timeBreakdown', () => {
  it('splits the user-facing time by component, leaving async work out', () => {
    const d = app()
    const t = generateTrace(d, simulate(d), { seed: 3 })!
    const rows = timeBreakdown(t)
    expect(rows.reduce((sum, r) => sum + r.self, 0)).toBeCloseTo(t.duration)
    expect(rows.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(1)
    expect(rows.some((r) => r.nodeId === 'w')).toBe(false)
    expect(rows[0].self).toBeGreaterThanOrEqual(rows[rows.length - 1].self)
  })
})
