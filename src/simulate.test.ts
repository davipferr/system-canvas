import { describe, expect, it } from 'vitest'
import {
  addNode,
  breakingPoint,
  capacityOf,
  connect,
  createDesign,
  queueingLatency,
  scaleTraffic,
  simulate,
  utilizationOf,
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

describe('queueing', () => {
  it('follows base / (1 − ρ) and stays finite when overloaded', () => {
    expect(queueingLatency(10, 0)).toBe(10)
    expect(queueingLatency(10, 0.5)).toBe(20)
    expect(queueingLatency(10, 0.9)).toBeCloseTo(100)
    expect(queueingLatency(10, 5)).toBeCloseTo(1000) // capped at 99% busy
  })
})

describe('capacity', () => {
  it('multiplies by replicas', () => {
    const d = build([['s', 'service', { capacity: 500, replicas: 4 }]])
    expect(capacityOf(d.nodes[0])).toEqual({ reads: 2000, writes: 2000 })
  })

  it('lets SQL read replicas help reads but not writes', () => {
    const d = build([['db', 'sql-db', { capacity: 2000, replicas: 3, shards: 1 }]])
    const capacity = capacityOf(d.nodes[0])
    expect(capacity).toEqual({ reads: 6000, writes: 2000 })
    expect(utilizationOf({ reads: 3000, writes: 1000 }, capacity)).toBe(1)
  })

  it('is unlimited for components without a capacity', () => {
    const d = build([['u', 'client']])
    expect(capacityOf(d.nodes[0]).reads).toBe(Infinity)
  })
})

describe('simulate', () => {
  it('computes load, utilization and end-to-end latency along a chain', () => {
    const d = build(
      [
        ['u', 'client', { rps: 1000, readRatio: 100 }],
        ['lb', 'load-balancer', { latency: 1, capacity: 50_000, replicas: 2 }],
        ['api', 'service', { latency: 30, capacity: 500, replicas: 4 }],
      ],
      [
        ['u', 'lb'],
        ['lb', 'api'],
      ],
    )
    const r = simulate(d)
    expect(r.totalRps).toBe(1000)
    expect(r.nodes.api.load).toEqual({ reads: 1000, writes: 0 })
    expect(r.nodes.api.utilization).toBe(0.5)
    expect(r.nodes.api.latency).toBe(60)
    expect(r.nodes.lb.utilization).toBe(0.01)
    expect(r.responseTime).toBeCloseTo(1 / 0.99 + 60)
    expect(r.bottleneck).toBe('api')
    expect(r.warnings).toEqual([])
  })

  it('load balancers split traffic evenly', () => {
    const d = build(
      [
        ['u', 'client', { rps: 1000 }],
        ['lb', 'load-balancer'],
        ['a', 'service'],
        ['b', 'service'],
      ],
      [
        ['u', 'lb'],
        ['lb', 'a'],
        ['lb', 'b'],
      ],
    )
    const r = simulate(d)
    expect(r.nodes.a.load).toEqual({ reads: 450, writes: 50 })
    expect(r.nodes.b.load).toEqual({ reads: 450, writes: 50 })
  })

  it('services call every dependency, filtered by reads/writes labels', () => {
    const d = build(
      [
        ['u', 'client', { rps: 1000, readRatio: 80 }],
        ['api', 'service', { capacity: 1000, replicas: 2 }],
        ['cache', 'cache'],
        ['db', 'sql-db'],
        ['log', 'stream'],
      ],
      [
        ['u', 'api'],
        ['api', 'cache', 'reads'],
        ['api', 'db', 'writes'],
        ['api', 'log', 'events'],
      ],
    )
    const r = simulate(d)
    expect(r.edges['edge-2'].traffic).toEqual({ reads: 800, writes: 0 })
    expect(r.nodes.db.load).toEqual({ reads: 0, writes: 200 })
    expect(r.nodes.log.load).toEqual({ reads: 800, writes: 200 })
    expect(r.edges['edge-4'].async).toBe(true)
  })

  it('caches absorb their hit rate and pass misses on (read-through)', () => {
    const d = build(
      [
        ['u', 'client', { rps: 1000, readRatio: 100 }],
        ['cache', 'cache', { hitRate: 80 }],
        ['db', 'sql-db'],
      ],
      [
        ['u', 'cache'],
        ['cache', 'db', 'miss'],
      ],
    )
    const r = simulate(d)
    expect(r.nodes.cache.absorbed).toBe(800)
    expect(r.nodes.db.load.reads).toBeCloseTo(200)
    // 80% of reads stop at the cache, so only 20% pay for the database round trip.
    expect(r.nodes.cache.responseTime).toBeCloseTo(r.nodes.cache.latency + 0.2 * r.nodes.db.responseTime)
  })

  it('databases only pass writes on (replication)', () => {
    const d = build(
      [
        ['u', 'client', { rps: 1000, readRatio: 70 }],
        ['primary', 'nosql-db'],
        ['replica', 'nosql-db'],
      ],
      [
        ['u', 'primary'],
        ['primary', 'replica', 'async'],
      ],
    )
    expect(simulate(d).nodes.replica.load).toEqual({ reads: 0, writes: 300 })
  })

  it('overloaded components drop the excess and shield what is behind them', () => {
    const d = build(
      [
        ['u', 'client', { rps: 3000, readRatio: 100 }],
        ['api', 'service', { latency: 30, capacity: 500, replicas: 2 }],
        ['db', 'sql-db'],
      ],
      [
        ['u', 'api'],
        ['api', 'db'],
      ],
    )
    const r = simulate(d)
    expect(r.nodes.api.utilization).toBe(3)
    expect(r.nodes.api.overloaded).toBe(true)
    expect(r.nodes.api.served.reads).toBeCloseTo(1000)
    expect(r.nodes.api.dropped).toBeCloseTo(2000)
    expect(r.nodes.api.latency).toBeCloseTo(3000)
    expect(r.nodes.db.load.reads).toBeCloseTo(1000)
    expect(r.overloaded).toEqual(['api'])
    expect(r.droppedRps).toBeCloseTo(2000)
  })

  it('a queue turns overload into backlog and keeps consumers off the response time', () => {
    const d = build(
      [
        ['u', 'client', { rps: 1000, readRatio: 0 }],
        ['api', 'service', { latency: 30, capacity: 500, replicas: 3 }],
        ['q', 'queue', { latency: 5, capacity: 20_000 }],
        ['w', 'worker', { latency: 200, capacity: 100, replicas: 2 }],
      ],
      [
        ['u', 'api'],
        ['api', 'q'],
        ['q', 'w'],
      ],
    )
    const r = simulate(d)
    expect(r.nodes.w.overloaded).toBe(true)
    expect(r.nodes.w.dropped).toBe(0)
    expect(r.nodes.w.backlog).toBeCloseTo(800)
    expect(r.backlogRps).toBeCloseTo(800)
    expect(r.edges['edge-3'].async).toBe(true)
    // The user waits for the API and the enqueue, never for the slow worker.
    expect(r.responseTime).toBeCloseTo(30 / (1 - 2 / 3) + 5 / 0.95)
  })

  it('queues share work between consumers; streams give every consumer everything', () => {
    const consumers = (via: ComponentKind) =>
      simulate(
        build(
          [
            ['u', 'client', { rps: 600 }],
            ['x', via],
            ['a', 'worker'],
            ['b', 'worker'],
          ],
          [
            ['u', 'x'],
            ['x', 'a'],
            ['x', 'b'],
          ],
        ),
      )
    expect(consumers('queue').nodes.a.load.reads + consumers('queue').nodes.a.load.writes).toBeCloseTo(300)
    expect(consumers('stream').nodes.a.load.reads + consumers('stream').nodes.a.load.writes).toBeCloseTo(600)
  })

  it('ignores edges that close a loop and warns about it', () => {
    const d = build(
      [
        ['u', 'client', { rps: 100 }],
        ['a', 'service'],
        ['b', 'service'],
      ],
      [
        ['u', 'a'],
        ['a', 'b'],
        ['b', 'a'],
      ],
    )
    const r = simulate(d)
    expect(r.edges['edge-3'].ignored).toBe(true)
    expect(r.nodes.a.load.reads + r.nodes.a.load.writes).toBe(100)
    expect(r.warnings).toEqual(['Service 2 → Service closes a loop, so the simulation ignores it'])
  })

  it('warns about missing clients and idle components', () => {
    expect(simulate(build([['a', 'service']])).warnings).toEqual([
      'Add a client: without one there is no traffic to simulate',
    ])
    const r = simulate(build([['u', 'client'], ['a', 'service'], ['c', 'cache']], [['u', 'a']]))
    expect(r.warnings).toEqual(['Cache receives no traffic'])
    expect(r.nodes.c.utilization).toBe(0)
  })

  it('handles an empty design', () => {
    const r = simulate(createDesign())
    expect(r.totalRps).toBe(0)
    expect(r.responseTime).toBe(0)
    expect(r.bottleneck).toBeNull()
  })
})

describe('load testing', () => {
  const chain = () =>
    build(
      [
        ['u', 'client', { rps: 1000, readRatio: 100 }],
        ['api', 'service', { capacity: 500, replicas: 4 }], // 2000 capacity
        ['db', 'sql-db', { capacity: 1000, replicas: 1 }], // 1000 capacity
      ],
      [
        ['u', 'api'],
        ['api', 'db'],
      ],
    )

  it('scales every client without touching the original', () => {
    const d = chain()
    const doubled = scaleTraffic(d, 2)
    expect(doubled.nodes[0].params.rps).toBe(2000)
    expect(d.nodes[0].params.rps).toBe(1000)
    expect(simulate(doubled).nodes.api.utilization).toBe(1)
  })

  it('finds the first component to break and at what multiple of current traffic', () => {
    expect(breakingPoint(chain())).toEqual({ factor: 1, nodeId: 'db' })
  })

  it('looks behind an overloaded component instead of trusting its shielded neighbours', () => {
    // At 3000 rps the API (2000) is overloaded and only lets 2000 through, so the database
    // looks merely 200% busy. Its real limit is still 1000 rps: the first thing to break.
    const d = scaleTraffic(chain(), 3)
    expect(simulate(d).nodes.db.utilization).toBeCloseTo(2)
    expect(breakingPoint(d)).toEqual({ factor: 1 / 3, nodeId: 'db' })
  })

  it('reports nothing when there is no traffic', () => {
    expect(breakingPoint(createDesign())).toBeNull()
  })
})
