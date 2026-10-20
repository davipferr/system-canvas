import { describe, expect, it } from 'vitest'
import {
  addNode,
  applyTraffic,
  componentCost,
  connect,
  createDesign,
  evaluateGoals,
  monthlyCost,
  type ComponentKind,
  type Design,
} from 'system-canvas'

type NodeDef = [id: string, kind: ComponentKind, params?: Record<string, number>]

function build(nodes: NodeDef[], edges: [string, string, string?][] = []): Design {
  let d = createDesign()
  nodes.forEach(([id, kind, params], i) => {
    d = addNode(d, kind, { x: i * 200, y: 0 }, { id, params }).design
  })
  for (const [from, to, label] of edges) d = connect(d, from, to, { label }).design
  return d
}

const result = (d: Design, goals: Parameters<typeof evaluateGoals>[1], id: string) =>
  evaluateGoals(d, goals).results.find((r) => r.id === id)!

describe('cost', () => {
  it('charges per instance: replicas × shards', () => {
    const d = build([
      ['u', 'client'],
      ['api', 'service', { replicas: 4 }],
      ['db', 'sql-db', { replicas: 2, shards: 3 }],
    ])
    expect(componentCost(d.nodes[0])).toBe(0)
    expect(componentCost(d.nodes[1])).toBe(4 * 60)
    expect(componentCost(d.nodes[2])).toBe(6 * 200)
    expect(monthlyCost(d)).toBe(240 + 1200)
  })
})

describe('applyTraffic', () => {
  it('shares the traffic between clients and sets the read ratio', () => {
    const d = applyTraffic(build([['a', 'client', { rps: 5 }], ['b', 'client', { rps: 7 }]]), 1000, 70)
    expect(d.nodes.map((n) => [n.params.rps, n.params.readRatio])).toEqual([
      [500, 70],
      [500, 70],
    ])
  })
})

describe('evaluateGoals', () => {
  const app = (replicas: number) =>
    build(
      [
        ['u', 'client', { rps: 1 }],
        ['api', 'service', { latency: 30, capacity: 500, replicas, availability: 99.5 }],
      ],
      [['u', 'api']],
    )

  it('uses the goal traffic, not whatever the client was set to', () => {
    // The client asks for 1 rps, but the goal is 1,000: two replicas cannot keep up.
    const r = result(app(1), { rps: 1000, readRatio: 90, noDrops: true }, 'noDrops')
    expect(r).toMatchObject({ passed: false, actual: '500 rps dropped' })
    expect(result(app(4), { rps: 1000, readRatio: 90, noDrops: true }, 'noDrops').passed).toBe(true)
  })

  it('checks response time, utilization, availability, SPOFs, cost and required parts', () => {
    const goals = {
      rps: 1000,
      readRatio: 90,
      maxResponseTime: 100,
      maxUtilization: 0.8,
      minAvailability: 0.999,
      noSpof: true,
      maxCost: 200,
      requires: ['cache' as ComponentKind],
    }
    const { passed, results } = evaluateGoals(app(4), goals)
    expect(passed).toBe(false)
    const byId = Object.fromEntries(results.map((r) => [r.id, r]))
    expect(byId.maxResponseTime).toMatchObject({ passed: true, actual: '60 ms' }) // 30 / (1 − 0.5)
    expect(byId.maxUtilization).toMatchObject({ passed: true, actual: 'Service at 50%' })
    expect(byId.minAvailability.passed).toBe(true)
    expect(byId.noSpof).toMatchObject({ passed: true, actual: 'none' })
    expect(byId.maxCost).toMatchObject({ passed: false, actual: '$240' })
    expect(byId['requires:cache']).toMatchObject({ passed: false, actual: 'no' })
  })

  it('flags single points of failure by name', () => {
    expect(result(app(1), { rps: 100, readRatio: 90, noSpof: true }, 'noSpof')).toMatchObject({
      passed: false,
      actual: 'Service',
    })
  })

  it('fails everything traffic-related without a client', () => {
    const { passed, results } = evaluateGoals(build([['api', 'service']]), {
      rps: 100,
      readRatio: 90,
      maxResponseTime: 1000,
    })
    expect(passed).toBe(false)
    expect(results.find((r) => r.id === 'client')!.passed).toBe(false)
    expect(results.find((r) => r.id === 'maxResponseTime')!.passed).toBe(false)
  })

  it('passes when every goal is met', () => {
    expect(evaluateGoals(app(4), { rps: 1000, readRatio: 90, noDrops: true, maxCost: 300 }).passed).toBe(true)
  })
})
