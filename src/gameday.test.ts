import { describe, expect, it } from 'vitest'
import {
  addNode,
  applyFault,
  budgetUsed,
  connect,
  createDesign,
  DEFAULT_SLO,
  faultCandidates,
  faultHarm,
  impactStartedAt,
  isHealthy,
  pickFault,
  recoveredAt,
  recoveryGrade,
  RECOVERY_HOLD_MINUTES,
  type Design,
  type MetricPoint,
} from 'system-canvas'
import { sampleDesign } from '../playground/sample'

const tiny = (): Design => {
  let d = createDesign()
  d = addNode(d, 'client', { x: 0, y: 0 }, { id: 'u', params: { rps: 1000 } }).design
  d = addNode(d, 'cache', { x: 200, y: 0 }, { id: 'c' }).design
  d = addNode(d, 'sql-db', { x: 400, y: 0 }, { id: 'db' }).design
  d = connect(d, 'u', 'c').design
  return connect(d, 'c', 'db').design
}

/** One point per minute; `bad(t)` marks the unhealthy minutes. */
const points = (minutes: number, bad: (t: number) => boolean): MetricPoint[] =>
  Array.from({ length: minutes }, (_, t) => ({
    t,
    multiplier: 1,
    rps: 1000,
    p50: 20,
    p99: 100,
    sloLatency: 100,
    errorRate: bad(t) ? 0.1 : 0,
    burnRate: bad(t) ? 100 : 0,
    maxUtilization: 0.5,
    backlog: 0,
    nodes: {},
  }))

describe('faults', () => {
  it('lists the faults that fit each component, plus a traffic spike', () => {
    const faults = faultCandidates(tiny())
    expect(faults).toContainEqual({ type: 'crash', target: 'c' })
    expect(faults).toContainEqual({ type: 'cache-flush', target: 'c' })
    expect(faults).toContainEqual({ type: 'slow', target: 'db' })
    expect(faults).not.toContainEqual({ type: 'cache-flush', target: 'db' })
    expect(faults.some((f) => f.target === 'u')).toBe(false)
    expect(faults).toContainEqual({ type: 'spike', target: null })
  })

  it('applies each fault without touching the original design', () => {
    const d = tiny()
    expect(applyFault(d, { type: 'crash', target: 'db' })).toMatchObject({ failed: ['db'], trafficMultiplier: 1 })
    expect(applyFault(d, { type: 'spike', target: null }).trafficMultiplier).toBe(3)
    const slow = applyFault(d, { type: 'slow', target: 'db' }).design.nodes[2].params.latency
    expect(slow).toBe(d.nodes[2].params.latency * 8)
    expect(applyFault(d, { type: 'capacity', target: 'db' }).design.nodes[2].params.capacity).toBeCloseTo(
      d.nodes[2].params.capacity * 0.3,
    )
    expect(applyFault(d, { type: 'cache-flush', target: 'c' }).design.nodes[1].params.hitRate).toBe(10)
    expect(d.nodes[1].params.hitRate).toBe(80)
  })

  it('measures harm: a crashed database burns the budget, a flushed cache overloads it', () => {
    const d = tiny()
    expect(faultHarm(d, { type: 'crash', target: 'db' }, DEFAULT_SLO).burnRate).toBeGreaterThan(100)
    // 1,000 reads at 10% hits put 900 rps on a 2,000 rps database: slower, but within the SLO.
    expect(faultHarm(d, { type: 'cache-flush', target: 'c' }, DEFAULT_SLO).burnRate).toBe(0)
  })

  it('only picks faults that visibly break the SLOs, deterministically per seed', () => {
    const d = sampleDesign()
    for (let seed = 1; seed <= 6; seed++) {
      const fault = pickFault(d, DEFAULT_SLO, seed)!
      const harm = faultHarm(d, fault, DEFAULT_SLO)
      expect(harm.burnRate >= 2 || harm.latencyRatio >= 1.2, JSON.stringify(fault)).toBe(true)
      expect(pickFault(d, DEFAULT_SLO, seed)).toEqual(fault)
    }
  })

  it('returns null when nothing would hurt', () => {
    // A lone, idle service: every fault leaves the (empty) SLOs intact.
    let d = createDesign()
    d = addNode(d, 'service', { x: 0, y: 0 }, { id: 'api' }).design
    expect(pickFault(d, DEFAULT_SLO, 1)).toBeNull()
  })
})

describe('incident timeline', () => {
  it('judges health by burn rate and SLO latency', () => {
    const [ok] = points(1, () => false)
    expect(isHealthy(ok, DEFAULT_SLO)).toBe(true)
    expect(isHealthy({ ...ok, sloLatency: 400 }, DEFAULT_SLO)).toBe(false)
    expect(isHealthy({ ...ok, burnRate: 2 }, DEFAULT_SLO)).toBe(false)
  })

  it('finds when users started hurting and when it really recovered', () => {
    // Fault at minute 10, users hurt from 12 to 29, a false recovery blip at 20–21.
    const history = points(60, (t) => t >= 12 && t < 30 && !(t >= 20 && t < 22))
    expect(impactStartedAt(history, 10, DEFAULT_SLO)).toBe(12)
    expect(recoveredAt(history, 10, DEFAULT_SLO)).toBe(30)
  })

  it('needs a healthy streak before calling it recovered', () => {
    const stillShaky = points(30 + RECOVERY_HOLD_MINUTES - 1, (t) => t >= 12 && t < 30)
    expect(recoveredAt(stillShaky, 10, DEFAULT_SLO)).toBeNull()
    expect(recoveredAt(points(40, () => false), 10, DEFAULT_SLO)).toBeNull() // never broke
  })

  it('counts the error budget an incident used', () => {
    // 10% of requests failing for 20 minutes, against 0.1% of 30 days.
    const history = points(60, (t) => t >= 10 && t < 30)
    expect(budgetUsed(history, 10, 30, DEFAULT_SLO)).toBeCloseTo((0.1 * 20) / (0.001 * 30 * 24 * 60), 3)
  })

  it('grades recovery time', () => {
    expect(recoveryGrade(10).grade).toBe('Excellent')
    expect(recoveryGrade(25).grade).toBe('Good')
    expect(recoveryGrade(45).grade).toBe('Okay')
    expect(recoveryGrade(90).grade).toBe('Rough')
  })
})
