import { useState } from 'react'
import {
  formatClock,
  getNode,
  TRAFFIC_PATTERNS,
  type AlertIncident,
  type AlertRule,
  type AlertState,
  type Design,
  type MetricPoint,
  type Slo,
  type TrafficPattern,
} from 'system-canvas'
import { AlertsPanel } from './AlertsPanel'
import { formatMs, formatRps } from './LoadStats'
import { TimeChart, type Marker } from './TimeChart'
import { CLOCK_SPEEDS, type Clock } from './useClock'

export type TimelineEvent = Marker

const rate = (v: number) => `${formatRps(v)} rps`
const percent = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.01 ? 2 : 1)}%`

export function Dashboard({
  design,
  metrics,
  events,
  clock,
  onPattern,
  onReset,
  selectedId,
  slo,
  errorBudget,
  rules,
  onRules,
  onResetRules,
  alertStates,
  incidents,
}: {
  design: Design
  metrics: MetricPoint[]
  events: TimelineEvent[]
  clock: Clock
  onPattern: (pattern: TrafficPattern) => void
  onReset: () => void
  selectedId: string | null
  slo: Slo
  errorBudget: number
  rules: AlertRule[]
  onRules: (rules: AlertRule[]) => void
  onResetRules: () => void
  alertStates: AlertState[]
  incidents: AlertIncident[]
}) {
  const [open, setOpen] = useState(true)
  const [hover, setHover] = useState<number | null>(null)
  const [tab, setTab] = useState<'charts' | 'alerts'>('charts')
  const times = metrics.map((p) => p.t)
  // Pages show up on the charts next to failures and pattern changes.
  const pageMarkers: TimelineEvent[] = incidents
    .filter((i) => rules.find((r) => r.id === i.ruleId)?.severity === 'page')
    .map((i) => ({ t: i.firedAt, label: `Paged: ${rules.find((r) => r.id === i.ruleId)!.name}`, kind: 'alert' }))
  const shared = { times, markers: [...events, ...pageMarkers], hover, onHover: setHover }
  const firing = alertStates.filter((s) => s.status === 'firing')
  const paging = firing.some((s) => rules.find((r) => r.id === s.ruleId)?.severity === 'page')
  const selected = selectedId ? getNode(design, selectedId) : undefined
  const component = selected && selected.kind !== 'client' ? selected : undefined
  const pattern = TRAFFIC_PATTERNS.find((p) => p.id === clock.pattern)!
  const at = hover !== null && hover < metrics.length ? metrics[hover] : metrics[metrics.length - 1]

  return (
    <section className={open ? 'dashboard open' : 'dashboard'} aria-label="Dashboard">
      <header className="dash-head">
        <button className="dash-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'} Dashboard
        </button>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'charts'} onClick={() => setTab('charts')}>
            Charts
          </button>
          <button role="tab" aria-selected={tab === 'alerts'} onClick={() => setTab('alerts')}>
            Alerts
            {firing.length > 0 && <span className={paging ? 'alert-count page' : 'alert-count'}>{firing.length}</span>}
          </button>
        </div>
        <span className="dash-clock" title="Simulated time">
          {formatClock(at?.t ?? clock.t)}
          {at && <span className="muted"> · traffic ×{at.multiplier.toFixed(2)}</span>}
        </span>
        <div className="dash-controls">
          <button onClick={() => clock.setRunning(!clock.running)} aria-label={clock.running ? 'Pause' : 'Play'}>
            {clock.running ? '❚❚' : '▶'}
          </button>
          <div className="chips" role="group" aria-label="Clock speed">
            {CLOCK_SPEEDS.map((s) => (
              <button
                key={s.value}
                className={clock.speed === s.value ? 'chip active' : 'chip'}
                onClick={() => clock.setSpeed(s.value)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <select
            value={clock.pattern}
            onChange={(e) => onPattern(e.target.value as TrafficPattern)}
            aria-label="Traffic pattern"
            title={pattern.description}
          >
            {TRAFFIC_PATTERNS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <button onClick={onReset} title="Clear the charts and go back to 08:00">
            Reset
          </button>
        </div>
      </header>

      {open && tab === 'alerts' && (
        <AlertsPanel
          design={design}
          rules={rules}
          onRules={onRules}
          onResetRules={onResetRules}
          states={alertStates}
          incidents={incidents}
          now={clock.t}
        />
      )}

      {open && tab === 'charts' && (
        <>
          <p className="muted small dash-pattern">{pattern.description}</p>
          <h4 className="dash-row-title">System</h4>
          <div className="dash-row">
            <TimeChart title="Traffic" series={[{ label: 'rps', tone: 'accent', values: metrics.map((p) => p.rps) }]} format={rate} {...shared} />
            <TimeChart
              title="Latency"
              series={[
                { label: 'p50', tone: 'ok', values: metrics.map((p) => p.p50) },
                { label: 'p99', tone: 'accent', values: metrics.map((p) => p.p99) },
              ]}
              format={formatMs}
              threshold={{ value: slo.latencyMs, label: `SLO: p${slo.latencyPercentile} ≤ ${slo.latencyMs} ms` }}
              {...shared}
            />
            <TimeChart
              title="Errors"
              series={[{ label: 'errors', tone: 'bad', values: metrics.map((p) => p.errorRate) }]}
              format={percent}
              threshold={{ value: errorBudget, label: `Error budget: ${percent(errorBudget)} of requests` }}
              {...shared}
            />
            <TimeChart
              title="Saturation (busiest)"
              series={[{ label: 'busiest', tone: 'warn', values: metrics.map((p) => p.maxUtilization) }]}
              format={percent}
              threshold={{ value: 1, label: '100% of capacity' }}
              {...shared}
            />
          </div>

          {component ? (
            <>
              <h4 className="dash-row-title">{component.label}</h4>
              <div className="dash-row">
                <TimeChart
                  title="Traffic"
                  series={[{ label: 'rps', tone: 'accent', values: metrics.map((p) => p.nodes[component.id]?.rps ?? 0) }]}
                  format={rate}
                  {...shared}
                />
                <TimeChart
                  title="Latency (avg)"
                  series={[{ label: 'avg', tone: 'ok', values: metrics.map((p) => p.nodes[component.id]?.latency ?? 0) }]}
                  format={formatMs}
                  {...shared}
                />
                <TimeChart
                  title="Errors"
                  series={[{ label: 'errors', tone: 'bad', values: metrics.map((p) => p.nodes[component.id]?.errorRate ?? 0) }]}
                  format={percent}
                  {...shared}
                />
                <TimeChart
                  title="Saturation"
                  series={[{ label: 'busy', tone: 'warn', values: metrics.map((p) => p.nodes[component.id]?.utilization ?? 0) }]}
                  format={percent}
                  threshold={{ value: 1, label: '100% of capacity' }}
                  {...shared}
                />
              </div>
            </>
          ) : (
            <p className="muted small">Select a component to chart its own golden signals here.</p>
          )}

          {events.length > 0 && (
            <ul className="dash-events">
              {events.slice(-6).map((e, i) => (
                <li key={`${e.t}:${i}`} className={e.kind}>
                  <span className="muted">{formatClock(e.t).split(' · ')[1]}</span> {e.label}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
