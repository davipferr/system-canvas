// Alerting: rules evaluated over the recorded metrics, the way Prometheus does it. A rule's
// condition has to hold continuously FOR a while before it fires (until then it is "pending"),
// which filters out blips; it resolves as soon as the condition stops holding.
//
// The defaults follow the usual SRE advice:
// * Page a human only for SYMPTOMS: users failing or waiting (error budget burning, SLO latency).
// * Everything else is a CAUSE: worth a ticket, not a 3 a.m. wake-up, because redundancy often
//   absorbs it (a dead replica behind a load balancer hurts nobody).

import type { MetricPoint } from './timeline'

export type AlertMetric = 'burnRate' | 'sloLatency' | 'utilization' | 'backlog' | 'down'

export interface AlertRule {
  id: string
  name: string
  metric: AlertMetric
  /** Fires when the metric is above this (see `ALERT_METRICS` for units). */
  threshold: number
  /** Simulated minutes the condition must hold before firing. */
  forMinutes: number
  severity: 'page' | 'ticket'
  kind: 'symptom' | 'cause'
  enabled: boolean
  /** Why the rule exists, shown next to it. */
  why: string
}

export const ALERT_METRICS: Record<AlertMetric, { label: string; unit: string; scope: 'system' | 'component' }> = {
  burnRate: { label: 'Error budget burn rate', unit: '×', scope: 'system' },
  sloLatency: { label: 'Latency at the SLO percentile, vs the SLO target', unit: '× target', scope: 'system' },
  utilization: { label: 'Utilization', unit: '%', scope: 'component' },
  backlog: { label: 'Queue backlog growth', unit: 'jobs/s', scope: 'component' },
  down: { label: 'Component is down', unit: '', scope: 'component' },
}

export const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: 'fast-burn',
    name: 'Error budget burning fast',
    metric: 'burnRate',
    threshold: 14.4,
    forMinutes: 5,
    severity: 'page',
    kind: 'symptom',
    enabled: true,
    why: 'At 14.4× a month of budget lasts about 2 days. Users are failing right now: wake someone up.',
  },
  {
    id: 'slow-burn',
    name: 'Error budget burning slowly',
    metric: 'burnRate',
    threshold: 1,
    forMinutes: 60,
    severity: 'ticket',
    kind: 'symptom',
    enabled: true,
    why: 'Above 1× the budget runs out before the month ends. Real, but it can wait for working hours.',
  },
  {
    id: 'slo-latency',
    name: 'Latency over the SLO',
    metric: 'sloLatency',
    threshold: 1,
    forMinutes: 5,
    severity: 'page',
    kind: 'symptom',
    enabled: true,
    why: 'Users are waiting longer than promised. Slow is the new down.',
  },
  {
    id: 'saturated',
    name: 'Component running hot',
    metric: 'utilization',
    threshold: 80,
    forMinutes: 10,
    severity: 'ticket',
    kind: 'cause',
    enabled: true,
    why: 'Above 80% queueing makes latency climb fast and a spike will overload it. Add capacity soon.',
  },
  {
    id: 'backlog',
    name: 'Queue falling behind',
    metric: 'backlog',
    threshold: 0,
    forMinutes: 5,
    severity: 'ticket',
    kind: 'cause',
    enabled: true,
    why: 'Workers are slower than producers, so jobs wait longer and longer. Nobody fails yet.',
  },
  {
    id: 'down',
    name: 'Component down',
    metric: 'down',
    threshold: 0,
    forMinutes: 1,
    severity: 'ticket',
    kind: 'cause',
    enabled: true,
    why: 'A cause, not a symptom: with redundancy users may not notice. If they do, the symptom alerts page.',
  },
]

export type AlertStatus = 'ok' | 'pending' | 'firing'

export interface AlertState {
  ruleId: string
  /** Component id for per-component rules, null for system-wide ones. */
  target: string | null
  status: AlertStatus
  /** When it started firing (firing) or when the condition began (pending). */
  since: number | null
  /** The metric's latest value, in the rule's units. */
  value: number
}

export interface AlertIncident {
  ruleId: string
  target: string | null
  firedAt: number
  /** Null while still firing. */
  resolvedAt: number | null
}

/** The metric for a rule at one point, in the rule's units (percent for utilization). */
function valueAt(metric: AlertMetric, point: MetricPoint, target: string | null, sloLatencyMs: number): number {
  const node = target ? point.nodes[target] : undefined
  switch (metric) {
    case 'burnRate':
      return point.burnRate
    case 'sloLatency':
      return sloLatencyMs > 0 ? point.sloLatency / sloLatencyMs : 0
    case 'utilization':
      return node && !node.failed ? node.utilization * 100 : 0
    case 'backlog':
      return node?.backlog ?? 0
    case 'down':
      return node?.failed ? 1 : 0
  }
}

/**
 * Replays the recorded points through every enabled rule. Returns each rule's current state
 * (per component for component rules) and every incident in the window.
 */
export function evaluateAlerts(
  rules: AlertRule[],
  points: MetricPoint[],
  sloLatencyMs: number,
): { states: AlertState[]; incidents: AlertIncident[] } {
  const states: AlertState[] = []
  const incidents: AlertIncident[] = []
  const components = [...new Set(points.flatMap((p) => Object.keys(p.nodes)))]

  for (const rule of rules) {
    if (!rule.enabled) continue
    const targets = ALERT_METRICS[rule.metric].scope === 'system' ? [null] : components
    for (const target of targets) {
      let runStart: number | null = null
      let open: AlertIncident | null = null
      let value = 0
      for (const point of points) {
        // A component that does not exist at this point (added later, deleted) cannot alert.
        if (target && !point.nodes[target]) continue
        value = valueAt(rule.metric, point, target, sloLatencyMs)
        if (value > rule.threshold) {
          runStart ??= point.t
          if (!open && point.t - runStart >= rule.forMinutes) {
            open = { ruleId: rule.id, target, firedAt: point.t, resolvedAt: null }
            incidents.push(open)
          }
        } else {
          if (open) open.resolvedAt = point.t
          open = null
          runStart = null
        }
      }
      // Quiet per-component rules stay out of the list; system rules always show their state.
      if (target && runStart === null) continue
      states.push({
        ruleId: rule.id,
        target,
        status: open ? 'firing' : runStart !== null ? 'pending' : 'ok',
        since: open ? open.firedAt : runStart,
        value,
      })
    }
  }
  incidents.sort((a, b) => a.firedAt - b.firedAt)
  return { states, incidents }
}
