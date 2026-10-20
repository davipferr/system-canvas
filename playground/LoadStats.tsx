import {
  behaviorOf,
  getNode,
  MAX_QUEUEING_UTILIZATION,
  monthlyCost,
  totalOf,
  type Behavior,
  type Design,
  type DesignNode,
  type SimulationResult,
} from 'system-canvas'

// ---- Formatting ----------------------------------------------------------------

export function formatRps(rps: number): string {
  if (!Number.isFinite(rps)) return '∞'
  if (rps >= 10_000) return `${(rps / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 })}k`
  if (rps >= 1000) return `${(rps / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`
  return rps.toLocaleString('en-US', { maximumFractionDigits: rps < 10 ? 1 : 0 })
}

export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} s`
  return `${ms.toLocaleString('en-US', { maximumFractionDigits: ms < 10 ? 1 : 0 })} ms`
}

export const formatPercent = (fraction: number) => `${Math.round(fraction * 100)}%`

/** ok below 70% busy, warn up to 100%, bad when overloaded. */
export function loadLevel(utilization: number): 'ok' | 'warn' | 'bad' {
  if (utilization > 1) return 'bad'
  if (utilization >= 0.7) return 'warn'
  return 'ok'
}

const behaviorText: Record<Behavior, string> = {
  split: 'Sends each request to one of its connections, spreading them evenly.',
  fanout: 'Every request calls each of its connections.',
  cache: 'Answers cache hits itself and passes only misses (and writes) on.',
  store: 'Answers every request itself and passes only writes on (replication).',
}

const trafficText = (reads: number, writes: number) =>
  `${formatRps(reads)} reads + ${formatRps(writes)} writes`

// ---- Whole system ----------------------------------------------------------------

export function SystemSummary({ design, sim }: { design: Design; sim: SimulationResult }) {
  const bottleneck = sim.bottleneck ? sim.nodes[sim.bottleneck] : null
  const name = (id: string) => getNode(design, id)?.label ?? id
  return (
    <section className="load">
      <h3>Under load</h3>
      <dl className="stats">
        <div>
          <dt>Incoming traffic</dt>
          <dd>{formatRps(sim.totalRps)} rps</dd>
        </div>
        <div>
          <dt>Avg response time</dt>
          <dd>{formatMs(sim.responseTime)}</dd>
        </div>
        <div className="wide">
          <dt>Estimated cost</dt>
          <dd>${monthlyCost(design).toLocaleString('en-US')} / month</dd>
        </div>
        <div className="wide">
          <dt>Bottleneck (busiest component)</dt>
          <dd>
            {bottleneck ? (
              <>
                {name(bottleneck.id)}{' '}
                <span className={`level ${loadLevel(bottleneck.utilization)}`}>{formatPercent(bottleneck.utilization)}</span>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        {sim.droppedRps > 0.5 && (
          <div className="wide bad-box">
            <dt>Requests dropped</dt>
            <dd>
              {formatRps(sim.droppedRps)} rps at{' '}
              {design.nodes
                .filter((n) => sim.nodes[n.id].dropped > 0.5)
                .map((n) => n.label)
                .join(', ')}
            </dd>
          </div>
        )}
        {sim.backlogRps > 0.5 && (
          <div className="wide warn-box">
            <dt>Queue backlog growing</dt>
            <dd>{formatRps(sim.backlogRps)} jobs per second</dd>
          </div>
        )}
      </dl>
      {sim.warnings.length > 0 && (
        <ul className="warnings">
          {sim.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---- One component -----------------------------------------------------------------

export function NodeLoad({ node, sim }: { node: DesignNode; sim: SimulationResult }) {
  const stats = sim.nodes[node.id]
  const behavior = behaviorOf(node.kind)

  if (node.kind === 'client') {
    return (
      <section className="load">
        <h3>Under load</h3>
        <dl className="stats">
          <div className="wide">
            <dt>Sends</dt>
            <dd>{trafficText(stats.load.reads, stats.load.writes)}</dd>
          </div>
          <div className="wide">
            <dt>Avg response time its users see</dt>
            <dd>{formatMs(stats.responseTime)}</dd>
          </div>
        </dl>
        <p className="muted small">{behaviorText.split}</p>
      </section>
    )
  }

  if (stats.failed) {
    return (
      <section className="load">
        <h3>Under load</h3>
        <p className="muted small">It is down, so it serves nothing. See Availability below.</p>
      </section>
    )
  }

  const idle = totalOf(stats.load) === 0
  const base = node.params.latency ?? 0
  const level = loadLevel(stats.utilization)
  const limited = Number.isFinite(stats.capacity.reads)

  return (
    <section className="load">
      <h3>Under load</h3>
      {idle ? (
        <p className="muted small">No traffic reaches this component yet.</p>
      ) : (
        <>
          {limited && (
            <div className={`meter ${level}`} aria-label={`Utilization ${formatPercent(stats.utilization)}`}>
              <span style={{ width: `${Math.min(100, stats.utilization * 100)}%` }} />
            </div>
          )}
          <dl className="stats">
            <div className="wide">
              <dt>Incoming</dt>
              <dd>{trafficText(stats.load.reads, stats.load.writes)}</dd>
            </div>
            {limited && (
              <div>
                <dt>Utilization</dt>
                <dd className={`level ${level}`}>{formatPercent(stats.utilization)}</dd>
              </div>
            )}
            {limited && (
              <div>
                <dt>Capacity</dt>
                <dd>
                  {stats.capacity.reads === stats.capacity.writes
                    ? `${formatRps(stats.capacity.reads)} rps`
                    : `${formatRps(stats.capacity.reads)} r / ${formatRps(stats.capacity.writes)} w`}
                </dd>
              </div>
            )}
            <div>
              <dt>Latency with queueing</dt>
              <dd>
                {formatMs(stats.latency)}
                {stats.utilization >= MAX_QUEUEING_UTILIZATION && '+'}
              </dd>
            </div>
            <div>
              <dt>Response time</dt>
              <dd>{formatMs(stats.responseTime)}</dd>
            </div>
            {behavior === 'cache' && (
              <div className="wide">
                <dt>Answered from cache</dt>
                <dd>{formatRps(stats.absorbed)} reads per second</dd>
              </div>
            )}
            {stats.dropped > 0.5 && (
              <div className="wide bad-box">
                <dt>Dropped</dt>
                <dd>{formatRps(stats.dropped)} rps over capacity</dd>
              </div>
            )}
            {stats.backlog > 0.5 && (
              <div className="wide warn-box">
                <dt>Backlog growing</dt>
                <dd>{formatRps(stats.backlog)} jobs per second pile up in the queue</dd>
              </div>
            )}
          </dl>
          {limited && base > 0 && (
            <p className="muted small">
              Queueing: {formatMs(base)} base ÷ (1 − {formatPercent(Math.min(stats.utilization, MAX_QUEUEING_UTILIZATION))}{' '}
              busy) = {formatMs(stats.latency)}. Response time adds the calls it waits on.
            </p>
          )}
        </>
      )}
      <p className="muted small">{behaviorText[behavior]}</p>
    </section>
  )
}

// ---- One connection -------------------------------------------------------------------

export function EdgeLoad({ edgeId, sim }: { edgeId: string; sim: SimulationResult }) {
  const stats = sim.edges[edgeId]
  if (stats.ignored) {
    return (
      <p className="callout warn-box">
        This connection closes a loop, so the simulation ignores it. Requests going around a loop would never finish.
      </p>
    )
  }
  return (
    <section className="load">
      <h3>Under load</h3>
      <dl className="stats">
        <div className="wide">
          <dt>Carries</dt>
          <dd>{trafficText(stats.traffic.reads, stats.traffic.writes)}</dd>
        </div>
        <div className="wide">
          <dt>Timing</dt>
          <dd>{stats.async ? 'Async: the caller does not wait for it' : 'Sync: the caller waits for the answer'}</dd>
        </div>
      </dl>
      <p className="muted small">
        Label it <b>reads</b> or <b>writes</b> to carry only that kind of request, and <b>async</b> or <b>events</b>{' '}
        to take it off the caller's response time.
      </p>
    </section>
  )
}
