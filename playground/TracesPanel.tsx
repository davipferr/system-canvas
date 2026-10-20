import { useEffect, useState } from 'react'
import {
  catalog,
  getNode,
  pickTrace,
  timeBreakdown,
  type Design,
  type SimulationResult,
  type Trace,
  type TracePick,
} from 'system-canvas'
import { formatMs } from './LoadStats'

const picks: { id: TracePick; label: string; title: string }[] = [
  { id: 'typical', label: 'Typical (p50)', title: 'The median of 200 sampled requests' },
  { id: 'slow', label: 'Slow (p99)', title: 'The p99 of 200 sampled requests: what to open when latency alerts fire' },
  { id: 'error', label: 'Failing', title: 'A request that failed, if any are failing right now' },
  { id: 'random', label: 'Random', title: 'Any one request' },
]

export function TracesPanel({
  design,
  sim,
  onSelectNode,
}: {
  /** The design traffic flows through (with a challenge's traffic applied). */
  design: Design
  /** The live simulation; a trace is captured from it on demand, then stays put. */
  sim: SimulationResult
  onSelectNode: (id: string) => void
}) {
  const [type, setType] = useState<'reads' | 'writes'>('reads')
  const [pick, setPick] = useState<TracePick>('typical')
  const [seed, setSeed] = useState(1)
  const [trace, setTrace] = useState<Trace | null>(null)

  // Capture when the question changes, not on every clock tick: a trace is a snapshot to study.
  useEffect(() => {
    setTrace(pickTrace(design, sim, { pick, type, seed }))
  }, [type, pick, seed])

  const name = (id: string) => getNode(design, id)?.label ?? id
  const total = trace ? Math.max(trace.end, 1e-9) : 1
  const pct = (ms: number) => `${(ms / total) * 100}%`
  const breakdown = trace ? timeBreakdown(trace) : []

  return (
    <div className="traces">
      <div className="trace-controls">
        <div className="tabs" role="group" aria-label="Request type">
          {(['reads', 'writes'] as const).map((t) => (
            <button key={t} aria-selected={type === t} onClick={() => setType(t)}>
              {t === 'reads' ? 'Read' : 'Write'}
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Which request">
          {picks.map((p) => (
            <button key={p.id} className={pick === p.id ? 'chip active' : 'chip'} title={p.title} onClick={() => setPick(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <button onClick={() => setSeed((s) => s + 200)} title="Sample a fresh batch of requests from the current traffic">
          New trace
        </button>
      </div>

      {!trace ? (
        <p className="muted small">
          {pick === 'error'
            ? 'No request is failing right now. Fail a component (select it and press X), then try again.'
            : `No ${type} are flowing right now. Check that a client sends ${type}.`}
        </p>
      ) : (
        <>
          <p className="trace-summary">
            <span className="mono">trace {trace.id}</span>
            <span>
              {trace.type === 'reads' ? 'read' : 'write'} from <b>{name(trace.clientId)}</b>
            </span>
            <span>
              user waited <b>{formatMs(trace.duration)}</b>
            </span>
            {trace.end > trace.duration + 0.5 && <span className="muted">async work ran to {formatMs(trace.end)}</span>}
            <span className={trace.error ? 'trace-status error' : 'trace-status ok'}>{trace.error ? 'error' : 'ok'}</span>
          </p>

          <div className="waterfall" role="table" aria-label="Trace waterfall">
            <div className="wf-axis" aria-hidden="true">
              {[0, 0.5, 1].map((f) => (
                <span key={f} style={{ left: `${f * 100}%` }}>
                  {formatMs(total * f)}
                </span>
              ))}
            </div>
            {trace.spans.map((span) => {
              const node = getNode(design, span.nodeId)
              return (
                <div
                  key={span.id}
                  className={['wf-row', span.async && 'async', span.error && 'error'].filter(Boolean).join(' ')}
                  role="row"
                  onClick={() => onSelectNode(span.nodeId)}
                  title="Select this component"
                >
                  <div className="wf-name" role="cell" style={{ paddingLeft: span.depth * 12 }}>
                    <span className="wf-label">{node?.label ?? span.nodeId}</span>
                    <span className="muted">{node ? catalog[node.kind].label : ''}</span>
                  </div>
                  <div className="wf-track" role="cell">
                    <div
                      className="wf-response"
                      style={{ left: pct(trace.duration) }}
                      title={`Response sent at ${formatMs(trace.duration)}`}
                    />
                    <div
                      className="wf-bar"
                      data-category={node ? catalog[node.kind].category : undefined}
                      style={{ left: pct(span.start), width: `max(2px, ${pct(span.duration)})` }}
                    >
                      <div className="wf-self" style={{ width: span.duration > 0 ? `${(span.self / span.duration) * 100}%` : '100%' }} />
                    </div>
                  </div>
                  <div className="wf-time" role="cell">
                    {span.error ? (span.duration > 0.05 ? `failed · ${formatMs(span.duration)}` : 'failed') : formatMs(span.duration)}
                    {span.async && <span className="muted"> async</span>}
                  </div>
                </div>
              )
            })}
          </div>

          {breakdown.length > 0 && (
            <div className="breakdown">
              <h4 className="dash-row-title">Where the user's {formatMs(trace.duration)} went</h4>
              {breakdown.map((row) => (
                <div key={row.nodeId} className="breakdown-row">
                  <span>{name(row.nodeId)}</span>
                  <span className="breakdown-bar">
                    <span style={{ width: `${row.share * 100}%` }} />
                  </span>
                  <span className="muted">
                    {formatMs(row.self)} · {Math.round(row.share * 100)}%
                  </span>
                </div>
              ))}
            </div>
          )}

          <p className="muted small">
            Each bar is a span: when a component started on this request and how long it took. The darker part is
            its own work; the rest is waiting for the calls below it. Dashed spans are async: they run after the
            response is sent (the vertical line), so the user never waits for them. Click a row to select the
            component.
          </p>
        </>
      )}
    </div>
  )
}
