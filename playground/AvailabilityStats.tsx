import {
  componentAvailability,
  downtimePerYear,
  getNode,
  instanceAvailability,
  isSingleInstance,
  nines,
  SPOF_THRESHOLD,
  type AvailabilityResult,
  type Design,
  type DesignNode,
  type SimulationResult,
} from 'system-canvas'
import { formatPercent, formatRps } from './LoadStats'

/**
 * Enough decimals to show the nines that matter, rounded DOWN so 99.9996% never reads as 100%:
 * 0.998 → "99.8%", 0.99995 → "99.995%".
 */
export function formatAvailability(a: number): string {
  if (a >= 1) return '100%'
  if (a <= 0) return '0%'
  const digits = Math.min(6, Math.max(1, Math.ceil(nines(a)) - 1))
  const factor = 10 ** digits
  const floored = Math.floor(a * 100 * factor) / factor
  return `${floored.toFixed(digits).replace(/\.?0+$/, '')}%`
}

/** 8.77 h → "8.8 h", 0.5 h → "31 min", 2000 h → "83 days". */
export function formatDowntime(hours: number): string {
  if (hours < 1 / 60) return `${Math.round(hours * 3600)} s`
  if (hours < 1) return `${Math.round(hours * 60)} min`
  if (hours < 48) return `${hours.toLocaleString('en-US', { maximumFractionDigits: 1 })} h`
  return `${Math.round(hours / 24)} days`
}

export interface FailureState {
  failed: ReadonlySet<string>
  impact: Record<string, number>
  spofs: string[]
  toggle: (id: string) => void
  restoreAll: () => void
}

// ---- Whole system ----------------------------------------------------------------

export function SystemAvailability({
  design,
  availability,
  failures,
}: {
  design: Design
  availability: AvailabilityResult
  failures: FailureState
}) {
  const name = (id: string) => getNode(design, id)?.label ?? id
  return (
    <section className="load">
      <h3>Availability</h3>
      <dl className="stats">
        <div>
          <dt>Requests that succeed</dt>
          <dd>{formatAvailability(availability.system)}</dd>
        </div>
        <div>
          <dt>Expected downtime</dt>
          <dd>{formatDowntime(downtimePerYear(availability.system))} / year</dd>
        </div>
      </dl>
      {failures.failed.size > 0 && (
        <div className="callout bad-box failed-list">
          <span>
            <b>Down:</b> {[...failures.failed].map(name).join(', ')}
          </span>
          <button onClick={failures.restoreAll}>Restore all</button>
        </div>
      )}
      {failures.spofs.length > 0 ? (
        <div className="spofs">
          <p className="small">
            <b>Single points of failure</b>: one instance each, and users notice when it dies.
          </p>
          <ul>
            {failures.spofs.map((id) => (
              <li key={id}>
                <span className="spof-tag">SPOF</span> {name(id)}{' '}
                <span className="muted">
                  ({formatPercent(failures.impact[id])} of requests fail without it)
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        design.nodes.length > 1 && <p className="muted small">No single points of failure: every critical component has a backup.</p>
      )}
    </section>
  )
}

// ---- One component -----------------------------------------------------------------

export function NodeAvailability({
  node,
  availability,
  failures,
  sim,
}: {
  node: DesignNode
  availability: AvailabilityResult
  failures: FailureState
  sim: SimulationResult
}) {
  if (node.kind === 'client') {
    return (
      <section className="load">
        <h3>Availability</h3>
        <p className="small">
          {formatAvailability(availability.success[node.id])} of this client's requests succeed.
        </p>
      </section>
    )
  }

  const down = failures.failed.has(node.id)
  const one = instanceAvailability(node)
  const replicas = node.params.replicas ?? 1
  const shards = node.params.shards ?? 1
  const impact = failures.impact[node.id] ?? 0
  const spof = failures.spofs.includes(node.id)
  const lost = sim.nodes[node.id].dropped + sim.nodes[node.id].backlog

  return (
    <section className="load">
      <h3>Availability</h3>
      {down ? (
        <p className="callout bad-box">
          <b>Down.</b>{' '}
          {lost > 0.5
            ? `Everything that reaches it is lost: ${formatRps(lost)} rps.`
            : 'No traffic reaches it right now.'}
        </p>
      ) : (
        <dl className="stats">
          <div>
            <dt>This component</dt>
            <dd>{formatAvailability(componentAvailability(node))}</dd>
          </div>
          <div>
            <dt>Requests through it</dt>
            <dd>{formatAvailability(availability.success[node.id])}</dd>
          </div>
        </dl>
      )}
      {!down && (replicas > 1 || shards > 1) && (
        <p className="muted small">
          {replicas > 1 && (
            <>
              {replicas} replicas in parallel: 1 − (1 − {formatAvailability(one)})<sup>{replicas}</sup>
            </>
          )}
          {replicas > 1 && shards > 1 && ', '}
          {shards > 1 && <>{shards} shards in series (all must be up)</>}.
        </p>
      )}
      {spof && (
        <p className="callout bad-box">
          <span className="spof-tag">SPOF</span> Single point of failure: it runs as one instance and{' '}
          {formatPercent(impact)} of requests fail without it. Add replicas or a fallback.
        </p>
      )}
      {!spof && !down && impact >= SPOF_THRESHOLD && !isSingleInstance(node) && (
        <p className="muted small">
          If it went down entirely, {formatPercent(impact)} of requests would fail. Its{' '}
          {replicas > 1 ? 'replicas make' : 'distributed design makes'} that unlikely.
        </p>
      )}
      {!down && impact < SPOF_THRESHOLD && (
        <p className="muted small">Users would barely notice if it went down.</p>
      )}
      <button className={down ? 'primary' : 'danger'} onClick={() => failures.toggle(node.id)} title="Shortcut: X">
        {down ? 'Bring back up' : 'Fail this component'}
      </button>
    </section>
  )
}
