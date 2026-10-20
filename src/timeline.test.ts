import { describe, expect, it } from 'vitest'
import {
  addNode,
  connect,
  createDesign,
  formatClock,
  metricPoint,
  patternMultiplier,
  sampleRequests,
  simulate,
  TRAFFIC_PATTERNS,
} from 'system-canvas'

const at = (hour: number, minute = 0) => hour * 60 + minute

describe('traffic patterns', () => {
  it('steady never changes', () => {
    for (const t of [0, 123, 5000]) expect(patternMultiplier('steady', t)).toBe(1)
  })

  it('daily peaks at 20:00 and bottoms out at 08:00, every day', () => {
    expect(patternMultiplier('daily', at(20))).toBeCloseTo(1)
    expect(patternMultiplier('daily', at(8))).toBeCloseTo(0.3)
    expect(patternMultiplier('daily', at(24 + 20))).toBeCloseTo(1)
    expect(patternMultiplier('daily', at(14))).toBeCloseTo(0.65)
  })

  it('spike jumps to 3× for five minutes at half past the hour', () => {
    expect(patternMultiplier('spike', at(9, 10))).toBe(1)
    expect(patternMultiplier('spike', at(9, 30.5))).toBeCloseTo(2)
    expect(patternMultiplier('spike', at(9, 33))).toBe(3)
    expect(patternMultiplier('spike', at(9, 35.5))).toBeCloseTo(2)
    expect(patternMultiplier('spike', at(9, 40))).toBe(1)
  })

  it('ramp climbs from 0.5× to 2× every hour', () => {
    expect(patternMultiplier('ramp', at(9))).toBe(0.5)
    expect(patternMultiplier('ramp', at(9, 30))).toBeCloseTo(1.25)
    expect(patternMultiplier('ramp', at(9, 59.99))).toBeCloseTo(2, 2)
  })

  it('describes every pattern', () => {
    expect(TRAFFIC_PATTERNS.map((p) => p.id)).toEqual(['steady', 'daily', 'spike', 'ramp'])
  })
})

describe('clock', () => {
  it('formats day and time', () => {
    expect(formatClock(at(8))).toBe('Day 1 · 08:00')
    expect(formatClock(at(15, 5))).toBe('Day 1 · 15:05')
    expect(formatClock(at(24 + 1, 30.9))).toBe('Day 2 · 01:30')
  })
})

describe('metricPoint', () => {
  it('records system and per-component signals for one moment', () => {
    let d = createDesign()
    d = addNode(d, 'client', { x: 0, y: 0 }, { id: 'u', params: { rps: 1000 } }).design
    d = addNode(d, 'service', { x: 200, y: 0 }, { id: 'api', params: { capacity: 500, replicas: 2 } }).design
    d = connect(d, 'u', 'api').design
    const sim = simulate(d)
    const p = metricPoint(at(9), 1, sim, sampleRequests(d, sim, { count: 4000 }), 0.001)
    expect(p.t).toBe(at(9))
    expect(p.rps).toBe(1000)
    expect(p.maxUtilization).toBe(1)
    expect(p.nodes.api).toMatchObject({ rps: 1000, utilization: 1, errorRate: 0, backlog: 0, failed: false })
    expect(p.sloLatency).toBe(p.p99) // the SLO percentile defaults to 99
    expect(p.p99).toBeGreaterThan(p.p50)
    expect(p.burnRate).toBe(0)
  })

  it('turns failures into an error rate and burn rate', () => {
    let d = createDesign()
    d = addNode(d, 'client', { x: 0, y: 0 }, { id: 'u', params: { rps: 1000 } }).design
    d = addNode(d, 'service', { x: 200, y: 0 }, { id: 'api' }).design
    d = connect(d, 'u', 'api').design
    const sim = simulate(d, { failed: new Set(['api']) })
    const p = metricPoint(0, 1, sim, sampleRequests(d, sim, { count: 1000 }), 0.001)
    expect(p.errorRate).toBe(1)
    expect(p.burnRate).toBe(1000)
    expect(p.nodes.api.errorRate).toBe(1)
    expect(p.nodes.api.failed).toBe(true)
    expect(p.maxUtilization).toBe(0) // a dead component is not "busy"
  })
})
