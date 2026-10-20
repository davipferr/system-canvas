import { setSlo, SLO_PERCENTILES, SLO_WINDOW_DAYS, type Design, type Slo, type SloReport } from 'system-canvas'
import type { Editor } from './Canvas'
import { formatAvailability } from './AvailabilityStats'
import { NumberField } from './fields'
import { formatMs } from './LoadStats'

const AVAILABILITY_TARGETS = [99, 99.5, 99.9, 99.95, 99.99, 99.999]

/** 0.4 h → "24 min", 30 h → "30 h", 200 h → "8 days". */
export function formatHours(hours: number): string {
  if (!Number.isFinite(hours)) return 'never'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`
  if (hours < 48) return `${Math.round(hours)} h`
  return `${Math.round(hours / 24)} days`
}

export const formatBurn = (rate: number) =>
  rate === 0 ? '0×' : `${rate.toLocaleString('en-US', { maximumFractionDigits: rate < 10 ? 1 : 0 })}×`

const pLabel = (p: number) => `p${p}`

function Status({ ok }: { ok: boolean }) {
  return <span className={ok ? 'slo-status ok' : 'slo-status fail'}>{ok ? '✓ met' : '✗ missed'}</span>
}

export function SloPanel({
  design,
  slo,
  report,
  samples,
  editor,
}: {
  design: Design
  slo: Slo
  report: SloReport
  /** How many simulated requests the percentiles come from. */
  samples: number
  editor: Editor
}) {
  const update = (patch: Partial<Slo>) => editor.push(setSlo(design, { ...slo, ...patch }), 'slo')
  const targets = AVAILABILITY_TARGETS.includes(slo.availability)
    ? AVAILABILITY_TARGETS
    : [...AVAILABILITY_TARGETS, slo.availability].sort((a, b) => a - b)
  const { latency } = report

  return (
    <section className="load slo">
      <h3>SLOs and error budget</h3>

      <div className="slo-form">
        <label>
          <span>Availability</span>
          <select value={slo.availability} onChange={(e) => update({ availability: Number(e.target.value) })}>
            {targets.map((t) => (
              <option key={t} value={t}>
                ≥ {t}%
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Latency</span>
          <select
            value={slo.latencyPercentile}
            onChange={(e) => update({ latencyPercentile: Number(e.target.value) })}
            aria-label="Latency percentile"
          >
            {SLO_PERCENTILES.map((p) => (
              <option key={p} value={p}>
                {pLabel(p)}
              </option>
            ))}
          </select>
          <span className="muted">≤</span>
          <NumberField value={slo.latencyMs} label="Latency threshold in ms" onCommit={(ms) => update({ latencyMs: ms })} />
          <span className="muted">ms</span>
        </label>
      </div>

      {samples === 0 ? (
        <p className="muted small">Add a client that sends traffic to measure the SLOs.</p>
      ) : (
        <>
          <dl className="signals">
            <div className={report.availabilityMet ? 'signal' : 'signal bad-box'}>
              <dt>
                Availability <Status ok={report.availabilityMet} />
              </dt>
              <dd>{formatAvailability(report.expectedAvailability)}</dd>
              <p>expected from component failures; target {slo.availability}%</p>
            </div>
            <div className={latency.met ? 'signal' : 'signal bad-box'}>
              <dt>
                Latency <Status ok={latency.met} />
              </dt>
              <dd>
                {pLabel(slo.latencyPercentile)} {formatMs(latency.atTarget)}
              </dd>
              <p>
                {(latency.fastFraction * 100).toFixed(1)}% of requests under {formatMs(slo.latencyMs)}; target{' '}
                {slo.latencyPercentile}%
              </p>
            </div>
          </dl>

          <div className="budget">
            <p className="small">
              <b>Error budget:</b> {(report.errorBudget * 100).toLocaleString('en-US', { maximumFractionDigits: 3 })}% of
              requests may fail, about <b>{formatHours(report.budgetMinutes / 60)}</b> of full outage per{' '}
              {SLO_WINDOW_DAYS} days.
            </p>
            <div className="budget-bar" aria-label={`Ordinary failures use ${Math.round(report.expectedBudgetUse * 100)}% of the budget`}>
              <span
                className={report.expectedBudgetUse > 1 ? 'bad' : report.expectedBudgetUse > 0.7 ? 'warn' : 'ok'}
                style={{ width: `${Math.min(100, report.expectedBudgetUse * 100)}%` }}
              />
            </div>
            <p className="muted small">
              Ordinary component failures use about {Math.round(report.expectedBudgetUse * 100)}% of it
              {report.expectedBudgetUse > 1 ? ': this design cannot meet the target even on a good month.' : ', leaving the rest for incidents and deploys.'}
            </p>
            <p className={report.burnRate > 1 ? 'callout bad-box small' : 'muted small'}>
              {report.currentErrorRate === 0 ? (
                <>
                  <b>Burn rate 0×:</b> nothing is failing right now.
                </>
              ) : (
                <>
                  <b>Burn rate {formatBurn(report.burnRate)}:</b> {(report.currentErrorRate * 100).toFixed(2)}% of
                  requests are failing right now
                  {report.burnRate > 1
                    ? `, so the whole ${SLO_WINDOW_DAYS}-day budget would be gone in ${formatHours(report.hoursToExhaustion)}.`
                    : ', slower than the budget allows.'}
                </>
              )}
            </p>
          </div>

          <div className="percentiles">
            {(['p50', 'p95', 'p99'] as const).map((p) => (
              <span key={p}>
                <b>{p}</b> {formatMs(latency[p])}
              </span>
            ))}
          </div>
          <p className="muted small">
            Percentiles come from {samples.toLocaleString('en-US')} simulated requests, each with its own random
            waits at every component.
          </p>
        </>
      )}
    </section>
  )
}
