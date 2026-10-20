import type { PointerEvent } from 'react'

export interface Series {
  label: string
  values: number[]
  /** Picks the line colour (see .chart-line.* in styles.css). */
  tone: 'accent' | 'ok' | 'warn' | 'bad' | 'muted'
}

export interface Marker {
  t: number
  label: string
  kind: 'fail' | 'recover' | 'change' | 'alert'
}

const W = 1000
const H = 100

/**
 * A small time-series panel. Lines are drawn in a stretched 1000×100 box (strokes keep their
 * width via vector-effect), so the chart fills any width without measuring the DOM. All charts
 * share one hover position, so the crosshair moves through every panel at once, as in Grafana.
 */
export function TimeChart({
  title,
  times,
  series,
  format,
  threshold,
  markers,
  hover,
  onHover,
}: {
  title: string
  /** Simulated minutes for each point, ascending. */
  times: number[]
  series: Series[]
  format: (value: number) => string
  /** A dashed reference line: an SLO, a budget, 100% capacity. */
  threshold?: { value: number; label: string }
  markers: Marker[]
  /** Index of the hovered point, shared across charts. */
  hover: number | null
  onHover: (index: number | null) => void
}) {
  const n = times.length
  const t0 = times[0] ?? 0
  const span = Math.max(1e-9, (times[n - 1] ?? 0) - t0)
  const x = (t: number) => (n < 2 ? W : ((t - t0) / span) * W)
  const max = Math.max(1e-9, ...series.flatMap((s) => s.values), threshold ? threshold.value * 1.25 : 0) * 1.08
  const y = (v: number) => H - (v / max) * H

  const index = hover !== null && hover < n ? hover : n - 1
  const shown = series
    .map((s) => (index >= 0 ? `${series.length > 1 ? `${s.label} ` : ''}${format(s.values[index])}` : '—'))
    .join(' · ')

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (n === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const t = t0 + ((e.clientX - rect.left) / rect.width) * span
    // Nearest point in time.
    let best = 0
    for (let i = 1; i < n; i++) if (Math.abs(times[i] - t) < Math.abs(times[best] - t)) best = i
    onHover(best)
  }

  return (
    <figure className="chart">
      <figcaption>
        <span>{title}</span>
        <b>{shown}</b>
      </figcaption>
      <div className="chart-plot" onPointerMove={onMove} onPointerLeave={() => onHover(null)}>
        {n === 0 ? (
          <p className="muted small chart-empty">Waiting for data…</p>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label={`${title}: ${shown}`} role="img">
            {threshold && (
              <line
                className="chart-threshold"
                x1={0}
                x2={W}
                y1={y(threshold.value)}
                y2={y(threshold.value)}
                vectorEffect="non-scaling-stroke"
              >
                <title>{threshold.label}</title>
              </line>
            )}
            {markers
              .filter((m) => m.t >= t0 && m.t <= t0 + span)
              .map((m, i) => (
                <line
                  key={`${m.t}:${i}`}
                  className={`chart-marker ${m.kind}`}
                  x1={x(m.t)}
                  x2={x(m.t)}
                  y1={0}
                  y2={H}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{m.label}</title>
                </line>
              ))}
            {series.map((s) => (
              <polyline
                key={s.label}
                className={`chart-line ${s.tone}`}
                points={s.values.map((v, i) => `${x(times[i])},${y(v)}`).join(' ')}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {hover !== null && hover < n && (
              <line
                className="chart-crosshair"
                x1={x(times[hover])}
                x2={x(times[hover])}
                y1={0}
                y2={H}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        )}
      </div>
    </figure>
  )
}
