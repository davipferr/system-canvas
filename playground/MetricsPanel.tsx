import { getNode, type Design, type SimulationResult, type SloReport } from 'system-canvas'
import { formatAvailability } from './AvailabilityStats'
import { formatMs, formatPercent, formatRps, loadLevel } from './LoadStats'
import { formatBurn } from './SloPanel'

const MIN_FACTOR = 0.1
const MAX_FACTOR = 20
const presets = [0.5, 1, 2, 5, 10]

// The multiplier slider is logarithmic, so ×0.1 → ×1 takes as much travel as ×1 → ×10.
const toSlider = (factor: number) => Math.log(factor / MIN_FACTOR) / Math.log(MAX_FACTOR / MIN_FACTOR)
const fromSlider = (t: number) => {
  const raw = MIN_FACTOR * (MAX_FACTOR / MIN_FACTOR) ** t
  return Number(raw.toPrecision(raw < 1 ? 1 : 2))
}

const formatFactor = (factor: number) =>
  `×${factor.toLocaleString('en-US', { maximumFractionDigits: factor < 1 ? 2 : 1 })}`

export function MetricsPanel({
  design,
  sim,
  factor,
  onFactor,
  breaking,
  availability,
  spofCount,
  sloReport,
  trafficFactor,
}: {
  design: Design
  /** Simulation at the current multiplier. */
  sim: SimulationResult
  factor: number
  onFactor: (factor: number) => void
  /** First component to hit 100%, as a multiple of the design's own traffic. */
  breaking: { factor: number; nodeId: string } | null
  /** Fraction of requests that succeed, with current failures. */
  availability: number
  spofCount: number
  sloReport: SloReport
  /** Everything scaling the design's own traffic right now (multiplier × clock pattern). */
  trafficFactor: number
}) {
  const name = (id: string) => getNode(design, id)?.label ?? id
  const baseRps = trafficFactor > 0 ? sim.totalRps / trafficFactor : 0
  const bottleneck = sim.bottleneck ? sim.nodes[sim.bottleneck] : null

  return (
    // Starts collapsed: its header still shows rps and latency, and the dashboard below has the trends.
    <details className="metrics">
      <summary>
        <span className="live-dot" aria-hidden="true" />
        Live traffic
        <span className="muted">
          {formatRps(sim.totalRps)} rps · {formatMs(sim.responseTime)}
        </span>
      </summary>

      <div className="metrics-body">
        <div className="param">
          <div className="param-head">
            <label htmlFor="load-factor">Load multiplier</label>
            <span className="param-value">
              <b>{formatFactor(factor)}</b>
              <span className="muted">= {formatRps(sim.totalRps)} rps</span>
            </span>
          </div>
          <input
            id="load-factor"
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={toSlider(factor)}
            onChange={(e) => onFactor(fromSlider(Number(e.target.value)))}
          />
          <div className="chips">
            {presets.map((p) => (
              <button key={p} className={p === factor ? 'chip active' : 'chip'} onClick={() => onFactor(p)}>
                {formatFactor(p)}
              </button>
            ))}
          </div>
        </div>

        <dl className="stats">
          <div className={sloReport.latency.met ? undefined : 'bad-box'}>
            <dt>p99 latency</dt>
            <dd>{formatMs(sloReport.latency.p99)}</dd>
          </div>
          <div className={sloReport.burnRate > 1 ? 'bad-box' : undefined}>
            <dt>Error budget burn</dt>
            <dd>{formatBurn(sloReport.burnRate)}</dd>
          </div>
          <div>
            <dt>Busiest</dt>
            <dd>
              {bottleneck ? (
                <span className={`level ${loadLevel(bottleneck.utilization)}`}>
                  {formatPercent(bottleneck.utilization)}
                </span>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt>Availability</dt>
            <dd>{formatAvailability(availability)}</dd>
          </div>
          <div className={spofCount > 0 ? 'bad-box' : undefined}>
            <dt>SPOFs</dt>
            <dd>{spofCount}</dd>
          </div>
          {sim.droppedRps > 0.5 && (
            <div className="bad-box">
              <dt>Dropped</dt>
              <dd>{formatRps(sim.droppedRps)} rps</dd>
            </div>
          )}
          {sim.backlogRps > 0.5 && (
            <div className="warn-box">
              <dt>Backlog</dt>
              <dd>+{formatRps(sim.backlogRps)}/s</dd>
            </div>
          )}
        </dl>

        {breaking && (
          <p className="small">
            {breaking.factor > trafficFactor ? (
              <>
                First to break: <b>{name(breaking.nodeId)}</b> at {formatFactor(breaking.factor)} (
                {formatRps(baseRps * breaking.factor)} rps).
              </>
            ) : (
              <>
                Past the limit: <b>{name(breaking.nodeId)}</b> maxes out at {formatFactor(breaking.factor)} (
                {formatRps(baseRps * breaking.factor)} rps).
              </>
            )}
          </p>
        )}

        <div className="legend">
          <span>
            <i className="swatch read" /> read
          </span>
          <span>
            <i className="swatch write" /> write
          </span>
          <span>
            <i className="swatch async" /> async
          </span>
        </div>
      </div>
    </details>
  )
}
