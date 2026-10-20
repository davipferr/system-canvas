import { describe, expect, it } from 'vitest'
import { DEFAULT_ALERT_RULES, evaluateAlerts, type AlertRule, type MetricPoint, type NodeMetrics } from 'system-canvas'

/** A metric history, one point per simulated minute, from small overrides. */
function history(
  minutes: number,
  at: (t: number) => { burnRate?: number; sloLatency?: number; api?: Partial<NodeMetrics> },
): MetricPoint[] {
  return Array.from({ length: minutes }, (_, t) => {
    const o = at(t)
    return {
      t,
      multiplier: 1,
      rps: 1000,
      p50: 20,
      p99: o.sloLatency ?? 100,
      sloLatency: o.sloLatency ?? 100,
      errorRate: 0,
      burnRate: o.burnRate ?? 0,
      maxUtilization: 0.5,
      backlog: 0,
      nodes: {
        api: { rps: 1000, latency: 20, utilization: 0.5, errorRate: 0, backlog: 0, failed: false, ...o.api },
      },
    }
  })
}

const rule = (id: string, patch: Partial<AlertRule> = {}): AlertRule[] => [
  { ...DEFAULT_ALERT_RULES.find((r) => r.id === id)!, ...patch },
]

describe('evaluateAlerts', () => {
  it('waits for the condition to hold FOR the rule duration before firing', () => {
    // Burning 20× from minute 10 to minute 30.
    const points = history(40, (t) => ({ burnRate: t >= 10 && t < 30 ? 20 : 0 }))
    const { incidents, states } = evaluateAlerts(rule('fast-burn'), points, 300)
    expect(incidents).toEqual([{ ruleId: 'fast-burn', target: null, firedAt: 15, resolvedAt: 30 }])
    expect(states).toEqual([{ ruleId: 'fast-burn', target: null, status: 'ok', since: null, value: 0 }])
  })

  it('ignores blips shorter than the FOR duration', () => {
    const points = history(20, (t) => ({ burnRate: t === 5 || t === 6 ? 50 : 0 }))
    expect(evaluateAlerts(rule('fast-burn'), points, 300).incidents).toEqual([])
  })

  it('reports pending, then firing, while the condition holds', () => {
    const burning = (minutes: number) =>
      evaluateAlerts(rule('fast-burn'), history(minutes, () => ({ burnRate: 20 })), 300).states[0]
    expect(burning(3)).toMatchObject({ status: 'pending', since: 0 })
    expect(burning(10)).toMatchObject({ status: 'firing', since: 5, value: 20 })
  })

  it('compares latency to the SLO target', () => {
    const points = history(10, () => ({ sloLatency: 450 }))
    const { states } = evaluateAlerts(rule('slo-latency', { forMinutes: 0 }), points, 300)
    expect(states[0]).toMatchObject({ status: 'firing', value: 1.5 })
    expect(evaluateAlerts(rule('slo-latency'), points, 600).states[0].status).toBe('ok')
  })

  it('evaluates component rules per component, in percent for utilization', () => {
    const points = history(30, (t) => ({ api: { utilization: t >= 5 ? 0.9 : 0.5 } }))
    const { states, incidents } = evaluateAlerts(rule('saturated'), points, 300)
    expect(incidents).toEqual([{ ruleId: 'saturated', target: 'api', firedAt: 15, resolvedAt: null }])
    expect(states).toEqual([{ ruleId: 'saturated', target: 'api', status: 'firing', since: 15, value: 90 }])
  })

  it('leaves quiet components out of the states', () => {
    expect(evaluateAlerts(rule('saturated'), history(30, () => ({})), 300).states).toEqual([])
  })

  it('alerts on a component that is down, and on queues falling behind', () => {
    const points = history(10, (t) => ({ api: { failed: t >= 2, backlog: t >= 2 ? 50 : 0 } }))
    const down = evaluateAlerts(rule('down'), points, 300)
    expect(down.incidents[0]).toMatchObject({ target: 'api', firedAt: 3 })
    // A dead component is not "hot": its utilization reads as 0.
    expect(evaluateAlerts(rule('saturated', { forMinutes: 0 }), points, 300).incidents).toEqual([])
    expect(evaluateAlerts(rule('backlog'), points, 300).incidents[0]).toMatchObject({ target: 'api', firedAt: 7 })
  })

  it('skips disabled rules', () => {
    const points = history(20, () => ({ burnRate: 100 }))
    expect(evaluateAlerts(rule('fast-burn', { enabled: false }), points, 300)).toEqual({ states: [], incidents: [] })
  })

  it('pages only on symptoms by default', () => {
    for (const r of DEFAULT_ALERT_RULES) {
      if (r.severity === 'page') expect(r.kind, r.id).toBe('symptom')
    }
  })
})
