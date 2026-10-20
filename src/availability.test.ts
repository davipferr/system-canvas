import { describe, expect, it } from 'vitest'
import {
  addNode,
  analyzeAvailability,
  catalog,
  componentAvailability,
  componentKinds,
  connect,
  createDesign,
  downtimePerYear,
  failureImpact,
  nines,
  simulate,
  singlePointsOfFailure,
  type ComponentKind,
  type Design,
} from 'system-canvas'

type NodeDef = [id: string, kind: ComponentKind, params?: Record<string, number>]
type EdgeDef = [from: string, to: string, label?: string]

function build(nodes: NodeDef[], edges: EdgeDef[] = []): Design {
  let d = createDesign()
  nodes.forEach(([id, kind, params], i) => {
    d = addNode(d, kind, { x: i * 200, y: 0 }, { id, params }).design
  })
  for (const [from, to, label] of edges) d = connect(d, from, to, { label }).design
  return d
}

const one = (kind: ComponentKind, availability: number, extra: Record<string, number> = {}) => ({
  availability,
  ...(catalog[kind].params.some((p) => p.key === 'replicas') ? { replicas: 1 } : {}),
  ...extra,
})

describe('component availability', () => {
  it('every component except clients has a per-instance availability', () => {
    for (const kind of componentKinds) {
      const has = catalog[kind].params.some((p) => p.key === 'availability')
      expect(has, kind).toBe(kind !== 'client')
    }
  })

  it('puts replicas in parallel', () => {
    const d = build([['api', 'service', { availability: 99.5, replicas: 3 }]])
    expect(componentAvailability(d.nodes[0])).toBeCloseTo(1 - 0.005 ** 3, 12)
  })

  it('puts shards in series', () => {
    const d = build([['db', 'sql-db', { availability: 99.95, replicas: 1, shards: 2 }]])
    expect(componentAvailability(d.nodes[0])).toBeCloseTo(0.9995 ** 2, 12)
  })
})

describe('system availability', () => {
  it('multiplies along a chain (series)', () => {
    const d = build(
      [
        ['u', 'client', { rps: 100 }],
        ['api', 'service', one('service', 99.9)],
        ['db', 'sql-db', one('sql-db', 99.9)],
      ],
      [
        ['u', 'api'],
        ['api', 'db'],
      ],
    )
    expect(analyzeAvailability(d).system).toBeCloseTo(0.999 * 0.999, 12)
  })

  it('a load balancer makes its targets back each other up (parallel)', () => {
    const d = build(
      [
        ['u', 'client', { rps: 100 }],
        ['lb', 'load-balancer', { availability: 99.99, replicas: 2 }],
        ['a', 'service', one('service', 99)],
        ['b', 'service', one('service', 99)],
      ],
      [
        ['u', 'lb'],
        ['lb', 'a'],
        ['lb', 'b'],
      ],
    )
    const lb = 1 - 0.0001 ** 2
    expect(analyzeAvailability(d).system).toBeCloseTo(lb * (1 - 0.01 ** 2), 12)
  })

  it('only the requests that reach a dependency depend on it', () => {
    const d = build(
      [
        ['u', 'client', { rps: 100, readRatio: 100 }],
        ['cache', 'cache', one('cache', 99.9, { hitRate: 80 })],
        ['db', 'sql-db', one('sql-db', 99)],
      ],
      [
        ['u', 'cache'],
        ['cache', 'db'],
      ],
    )
    // 80% are cache hits and never touch the database.
    expect(analyzeAvailability(d).system).toBeCloseTo(0.999 * (0.8 + 0.2 * 0.99), 12)
  })

  it('treats reads and writes as separate requests, not independent coin flips', () => {
    const d = build(
      [
        ['u', 'client', { rps: 1000, readRatio: 80 }],
        ['api', 'service', one('service', 99.999)],
        ['cache', 'cache', one('cache', 99.9)],
        ['db', 'sql-db', one('sql-db', 99.9)],
      ],
      [
        ['u', 'api'],
        ['api', 'cache', 'reads'],
        ['api', 'db', 'writes'],
      ],
    )
    // Reads need only the cache, writes only the database. With both down every request fails;
    // multiplying the two as if independent would wrongly leave 0.2 × 0.8 = 16% succeeding.
    expect(analyzeAvailability(d, { failed: new Set(['cache', 'db']) }).system).toBe(0)
    // With only the database down, exactly the writes (20%) fail.
    const healthy = analyzeAvailability(d).system
    expect(analyzeAvailability(d, { failed: new Set(['db']) }).system).toBeCloseTo(0.8 * 0.99999 * 0.999, 12)
    expect(healthy).toBeCloseTo(0.99999 * 0.999, 12)
  })

  it('async work does not count against the user', () => {
    const d = build(
      [
        ['u', 'client', { rps: 100 }],
        ['api', 'service', one('service', 99.9)],
        ['q', 'queue', { availability: 99.95 }],
        ['w', 'worker', one('worker', 90)],
      ],
      [
        ['u', 'api'],
        ['api', 'q'],
        ['q', 'w'],
      ],
    )
    const healthy = analyzeAvailability(d).system
    expect(healthy).toBeCloseTo(0.999 * 0.9995, 12)
    expect(analyzeAvailability(d, { failed: new Set(['w']) }).system).toBeCloseTo(healthy, 12)
  })

  it('a failed component on the path takes its requests down with it', () => {
    const d = build(
      [
        ['u', 'client', { rps: 100 }],
        ['api', 'service'],
      ],
      [['u', 'api']],
    )
    expect(analyzeAvailability(d, { failed: new Set(['api']) }).system).toBe(0)
  })

  it('is 100% with nothing to serve', () => {
    expect(analyzeAvailability(createDesign()).system).toBe(1)
  })
})

describe('failures in the traffic simulation', () => {
  const pool = (router: ComponentKind) =>
    build(
      [
        ['u', 'client', { rps: 1000 }],
        ['r', router],
        ['a', 'service', { capacity: 1000, replicas: 1 }],
        ['b', 'service', { capacity: 1000, replicas: 1 }],
      ],
      [
        ['u', 'r'],
        ['r', 'a'],
        ['r', 'b'],
      ],
    )

  it('load balancers send everything to the targets still up', () => {
    const r = simulate(pool('load-balancer'), { failed: new Set(['a']) })
    expect(r.nodes.a.failed).toBe(true)
    expect(r.nodes.a.load.reads + r.nodes.a.load.writes).toBe(0)
    expect(r.nodes.b.utilization).toBeCloseTo(1)
    expect(r.droppedRps).toBeCloseTo(0)
  })

  it('other routers keep sending to a dead target, and those requests are lost', () => {
    const r = simulate(pool('api-gateway'), { failed: new Set(['a']) })
    expect(r.nodes.a.dropped).toBeCloseTo(500)
    expect(r.nodes.b.utilization).toBeCloseTo(0.5)
    expect(r.droppedRps).toBeCloseTo(500)
  })

  it('a queue keeps work for its surviving consumers', () => {
    const r = simulate(pool('queue'), { failed: new Set(['a']) })
    expect(r.nodes.b.utilization).toBeCloseTo(1)
  })

  it('a dead component passes nothing downstream and is never the bottleneck', () => {
    const d = build(
      [
        ['u', 'client', { rps: 100 }],
        ['api', 'service'],
        ['db', 'sql-db'],
      ],
      [
        ['u', 'api'],
        ['api', 'db'],
      ],
    )
    const r = simulate(d, { failed: new Set(['api']) })
    expect(r.nodes.api.dropped).toBe(100)
    expect(r.nodes.db.load).toEqual({ reads: 0, writes: 0 })
    expect(r.bottleneck).toBeNull()
  })
})

describe('single points of failure', () => {
  const app = () =>
    build(
      [
        ['u', 'client', { rps: 1000 }],
        ['cdn', 'cdn'],
        ['lb', 'load-balancer'], // 2 replicas by default
        ['api', 'service'], // 3 replicas by default
        ['db', 'sql-db'], // 1 replica by default
        ['pay', 'external-api'],
      ],
      [
        ['u', 'cdn', 'reads'],
        ['u', 'lb'],
        ['lb', 'api'],
        ['api', 'db'],
        ['api', 'pay', 'writes'],
      ],
    )

  it('flags single-instance components the users depend on, worst first', () => {
    const spofs = singlePointsOfFailure(app())
    expect(spofs.map((s) => s.id)).toEqual(['db', 'pay'])
    // The API gets 55% of requests (450 reads + all 100 writes; the other reads go to the CDN),
    // and every one of them needs the database...
    expect(spofs[0].impact).toBeCloseTo(0.55, 2)
    // ...but only the writes (10% of all requests) call the payment provider.
    expect(spofs[1].impact).toBeCloseTo(0.1, 2)
  })

  it('does not flag replicated or distributed-by-design components', () => {
    const impact = failureImpact(app())
    expect(impact.api).toBeGreaterThan(0.5) // losing every API replica hurts...
    const ids = singlePointsOfFailure(app()).map((s) => s.id)
    expect(ids).not.toContain('api') // ...but three replicas make that unlikely
    expect(ids).not.toContain('cdn')
    expect(ids).not.toContain('lb')
  })

  it('stops flagging a component once it has replicas', () => {
    let d = app()
    d = { ...d, nodes: d.nodes.map((n) => (n.id === 'db' ? { ...n, params: { ...n.params, replicas: 2 } } : n)) }
    expect(singlePointsOfFailure(d).map((s) => s.id)).toEqual(['pay'])
  })
})

describe('helpers', () => {
  it('converts availability to downtime and nines', () => {
    expect(downtimePerYear(0.999)).toBeCloseTo(8.766, 3)
    expect(nines(0.999)).toBeCloseTo(3)
    expect(nines(1)).toBe(Infinity)
  })
})
