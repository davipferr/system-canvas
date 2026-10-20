import {
  behaviorOf,
  getNode,
  MAX_QUEUEING_UTILIZATION,
  monthlyCost,
  P99_FACTOR,
  totalOf,
  type Behavior,
  type Design,
  type DesignNode,
  type RequestSample,
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

export function NodeLoad({
  node,
  sim,
  sample,
}: {
  node: DesignNode
  sim: SimulationResult
  /** Sampled requests, for errors as this component's callers see them. */
  sample: RequestSample
}) {
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
        <h3>Golden signals</h3>
        <p className="callout bad-box small">
          {stats.backlog > 0.5
            ? `Down, but behind a queue: nothing fails, the jobs wait (+${formatRps(stats.backlog)}/s of backlog).`
            : `Down: every request that reaches it is an error (${formatRps(stats.dropped)} rps).`}{' '}
          See Availability below.
        </p>
      </section>
    )
  }

  const idle = totalOf(stats.load) === 0
  const base = node.params.latency ?? 0
  const level = loadLevel(stats.utilization)
  const limited = Number.isFinite(stats.capacity.reads)
  const load = totalOf(stats.load)
  // Errors as callers see them: turned away here, or failed in something this component called.
  const seen = sample.nodes[node.id]
  const errorRate = seen && seen.visits > 0 ? seen.errors / seen.visits : load > 0 ? stats.dropped / load : 0
  const failing = errorRate >= 0.0005

  return (
    <section className="load">
      <h3>Golden signals</h3>
      {idle ? (
        <p className="muted small">No traffic reaches this component yet.</p>
      ) : (
        <>
          <dl className="signals">
            <div className="signal">
              <dt>Latency</dt>
              <dd>
                {formatMs(stats.latency)}
                {stats.utilization >= MAX_QUEUEING_UTILIZATION && '+'}
              </dd>
              <p>
                p99 {formatMs(stats.latency * P99_FACTOR)} · {formatMs(stats.responseTime)} with the calls it makes
              </p>
            </div>
            <div className="signal">
              <dt>Traffic</dt>
              <dd>{formatRps(load)} rps</dd>
              <p>{trafficText(stats.load.reads, stats.load.writes)}</p>
            </div>
            <div className={failing ? 'signal bad-box' : 'signal'}>
              <dt>Errors</dt>
              <dd>{failing ? `${(errorRate * 100).toFixed(1)}%` : 'none'}</dd>
              <p>
                {!failing
                  ? 'every request succeeds'
                  : stats.dropped > 0.5
                    ? `${formatRps(stats.dropped)} rps turned away here`
                    : 'failing further down, in something it calls'}
              </p>
            </div>
            <div className={stats.backlog > 0.5 ? 'signal warn-box' : 'signal'}>
              <dt>Saturation</dt>
              <dd className={limited ? `level ${level}` : undefined}>
                {limited ? formatPercent(stats.utilization) : '—'}
              </dd>
              {limited ? (
                <>
                  <div className={`meter ${level}`} aria-label={`Utilization ${formatPercent(stats.utilization)}`}>
                    <span style={{ width: `${Math.min(100, stats.utilization * 100)}%` }} />
                  </div>
                  <p>
                    of{' '}
                    {stats.capacity.reads === stats.capacity.writes
                      ? `${formatRps(stats.capacity.reads)} rps`
                      : `${formatRps(stats.capacity.reads)} reads / ${formatRps(stats.capacity.writes)} writes`}
                    {stats.backlog > 0.5 && `, backlog +${formatRps(stats.backlog)}/s`}
                  </p>
                </>
              ) : (
                <p>no capacity limit</p>
              )}
            </div>
          </dl>
          {behavior === 'cache' && (
            <p className="small">
              Answers <b>{formatRps(stats.absorbed)} reads/s</b> from cache.
            </p>
          )}
          {limited && base > 0 && (
            <p className="muted small">
              Queueing: {formatMs(base)} base ÷ (1 − {formatPercent(Math.min(stats.utilization, MAX_QUEUEING_UTILIZATION))}{' '}
              busy) = {formatMs(stats.latency)} on average. Waits are exponential, so p99 is ln(100) ≈ 4.6× that.
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
