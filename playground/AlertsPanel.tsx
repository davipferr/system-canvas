import {
  ALERT_METRICS,
  formatClock,
  getNode,
  type AlertIncident,
  type AlertRule,
  type AlertState,
  type Design,
} from 'system-canvas'
import { NumberField } from './fields'

const time = (t: number) => formatClock(t).split(' · ')[1]

function duration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  return `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min`
}

export function AlertsPanel({
  design,
  rules,
  onRules,
  onResetRules,
  states,
  incidents,
  now,
}: {
  design: Design
  rules: AlertRule[]
  onRules: (rules: AlertRule[]) => void
  onResetRules: () => void
  states: AlertState[]
  incidents: AlertIncident[]
  /** Current simulated time, for "firing for N min". */
  now: number
}) {
  const update = (id: string, patch: Partial<AlertRule>) =>
    onRules(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const name = (target: string | null) => (target ? (getNode(design, target)?.label ?? target) : 'System')
  const ruleOf = (id: string) => rules.find((r) => r.id === id)
  const pages = incidents.filter((i) => ruleOf(i.ruleId)?.severity === 'page').length

  return (
    <div className="alerts">
      <p className="callout small">
        <b>Page on symptoms, ticket on causes.</b> A page wakes someone up, so it should mean users are hurting
        right now. Causes (a hot or dead component) go in a ticket: with good redundancy users may never notice.
        A rule fires once its condition has held <i>for</i> its duration; until then it is <i>pending</i>.
      </p>

      <ul className="rules">
        {rules.map((rule) => {
          const metric = ALERT_METRICS[rule.metric]
          const ruleStates = states.filter((s) => s.ruleId === rule.id)
          const worst = ruleStates.find((s) => s.status === 'firing') ?? ruleStates.find((s) => s.status === 'pending')
          const status = !rule.enabled ? 'off' : (worst?.status ?? 'ok')
          return (
            <li key={rule.id} className={`rule ${status}`}>
              <div className="rule-head">
                <label className="rule-name">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => update(rule.id, { enabled: e.target.checked })}
                  />
                  {rule.name}
                </label>
                <span className={`badge ${rule.severity}`}>{rule.severity}</span>
                <span className="badge kind">{rule.kind}</span>
                <span className={`rule-status ${status}`}>{status}</span>
              </div>
              <div className="rule-condition small">
                {rule.metric === 'down' ? (
                  <>{metric.label}</>
                ) : (
                  <>
                    {metric.label} &gt;
                    <NumberField
                      value={rule.threshold}
                      label={`${rule.name} threshold`}
                      onCommit={(v) => update(rule.id, { threshold: Math.max(0, v) })}
                    />
                    {metric.unit}
                  </>
                )}
                <span className="muted">for</span>
                <NumberField
                  value={rule.forMinutes}
                  label={`${rule.name} duration`}
                  onCommit={(v) => update(rule.id, { forMinutes: Math.max(0, Math.round(v)) })}
                />
                <span className="muted">min</span>
                {metric.scope === 'component' && <span className="muted">(each component)</span>}
              </div>
              {rule.enabled && ruleStates.some((s) => s.status !== 'ok') && (
                <ul className="rule-targets small">
                  {ruleStates
                    .filter((s) => s.status !== 'ok')
                    .map((s) => (
                      <li key={s.target ?? 'system'} className={s.status}>
                        {name(s.target)}: {s.status} for {duration(now - (s.since ?? now))}
                      </li>
                    ))}
                </ul>
              )}
              <p className="muted small">{rule.why}</p>
            </li>
          )
        })}
      </ul>
      <button className="link-button" onClick={onResetRules}>
        Reset rules to defaults
      </button>

      <h4 className="dash-row-title">
        Incidents in this window: {pages} {pages === 1 ? 'page' : 'pages'}, {incidents.length - pages}{' '}
        {incidents.length - pages === 1 ? 'ticket' : 'tickets'}
      </h4>
      {incidents.length === 0 ? (
        <p className="muted small">Nothing has fired yet. Try failing a component or the Ramp pattern.</p>
      ) : (
        <ul className="incidents">
          {[...incidents].reverse().map((i) => {
            const rule = ruleOf(i.ruleId)
            return (
              <li key={`${i.ruleId}:${i.target}:${i.firedAt}`} className={i.resolvedAt === null ? 'open' : 'closed'}>
                <span className={`badge ${rule?.severity}`}>{rule?.severity}</span>
                <span>
                  <b>{rule?.name}</b> · {name(i.target)}
                </span>
                <span className="muted">
                  {time(i.firedAt)} →{' '}
                  {i.resolvedAt === null
                    ? `still firing (${duration(now - i.firedAt)})`
                    : `${time(i.resolvedAt)} (${duration(i.resolvedAt - i.firedAt)})`}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
