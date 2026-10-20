import { clampParam, type ParamSpec } from 'system-canvas'
import { useState } from 'react'

const STEPS = 1000

/** Ranges like 1 → 1,000,000 rps are unusable on a linear slider, so they get a log scale. */
const isLog = (spec: ParamSpec) => spec.min > 0 && spec.max / spec.min >= 1000

/** Availability moves in "nines" (90% → 99% → 99.9%...), each the same slider distance. */
const isNines = (spec: ParamSpec) => spec.key === 'availability'
const toNines = (percent: number) => -Math.log10(1 - percent / 100)
const fromNines = (n: number) => Number((100 * (1 - 10 ** -n)).toFixed(3))

function toSlider(spec: ParamSpec, value: number): number {
  if (isNines(spec)) return toNines(value)
  if (!isLog(spec)) return value
  return Math.round((Math.log(value / spec.min) / Math.log(spec.max / spec.min)) * STEPS)
}

function fromSlider(spec: ParamSpec, position: number): number {
  if (isNines(spec)) return clampParam(spec, fromNines(position))
  if (!isLog(spec)) return clampParam(spec, position)
  const raw = spec.min * (spec.max / spec.min) ** (position / STEPS)
  // Two significant digits keep log-slider values readable: 3,200 instead of 3,162.
  return clampParam(spec, Number(raw.toPrecision(2)))
}

/**
 * A number input that only applies on blur or Enter, so typing "5000" does not get clamped
 * to the minimum after the first "5".
 */
export function NumberField({
  value,
  label,
  onCommit,
}: {
  value: number
  label: string
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft))) onCommit(Number(draft))
    setDraft(null)
  }
  return (
    <input
      type="number"
      className="number-field"
      aria-label={label}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}

export function ParamField({
  spec,
  value,
  onChange,
  onSettle,
}: {
  spec: ParamSpec
  value: number
  onChange: (value: number) => void
  onSettle: () => void
}) {
  const log = isLog(spec)
  const nines = isNines(spec)
  const range = nines
    ? { min: toNines(spec.min), max: toNines(spec.max), step: 0.01 }
    : log
      ? { min: 0, max: STEPS, step: 1 }
      : { min: spec.min, max: spec.max, step: spec.step }
  return (
    <div className="param">
      <div className="param-head">
        <label htmlFor={`param-${spec.key}`}>{spec.label}</label>
        <span className="param-value">
          <NumberField value={value} label={spec.label} onCommit={(v) => onChange(clampParam(spec, v))} />
          {spec.unit && <span className="muted">{spec.unit}</span>}
        </span>
      </div>
      <input
        id={`param-${spec.key}`}
        type="range"
        min={range.min}
        max={range.max}
        step={range.step}
        value={toSlider(spec, value)}
        onChange={(e) => onChange(fromSlider(spec, Number(e.target.value)))}
        // A drag is one undo step; arrow-key nudges merge until the slider loses focus.
        onPointerUp={onSettle}
        onBlur={onSettle}
      />
    </div>
  )
}
