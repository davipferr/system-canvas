import { useState } from 'react'
import {
  budgetUsed,
  FAULT_TYPES,
  formatClock,
  getNode,
  impactStartedAt,
  recoveryGrade,
  REMEDY_MINUTES,
  WRONG_GUESS_PENALTY,
  type AlertIncident,
  type AlertRule,
  type Design,
  type FaultType,
  type MetricPoint,
  type Slo,
} from 'system-canvas'
import { isOver, type GameState } from './gameState'
import { Modal } from './Modal'

const time = (t: number) => formatClock(t).split(' · ')[1]
const minutes = (m: number) => `${Math.round(m)} min`
const TRAFFIC = '__traffic__'

// ---- While playing ------------------------------------------------------------------------

export function IncidentPanel({
  game,
  now,
  design,
  onGuess,
  onRemedy,
  onGiveUp,
}: {
  game: GameState
  now: number
  design: Design
  onGuess: (target: string | null, type: FaultType) => void
  onRemedy: () => void
  onGiveUp: () => void
}) {
  const components = design.nodes.filter((n) => n.kind !== 'client')
  const [target, setTarget] = useState(components[0]?.id ?? TRAFFIC)
  const [type, setType] = useState<FaultType>('crash')
  const wrong = game.guesses.filter((g) => !g.correct).length
  const fault = FAULT_TYPES[game.fault.type]
  const remedyReady = game.remedyAt !== null ? game.remedyAt + REMEDY_MINUTES : null

  return (
    <section className="incident" aria-label="Game day">
      <header>
        <b>🎲 Game day</b>
        <span className="muted">
          started {time(game.startedAt)} · now {time(now)}
        </span>
      </header>

      {game.diagnosedAt === null ? (
        <>
          <p className="small">
            Something will break (or already has). Use the dashboard, alerts and traces to find it, then name it.
          </p>
          <div className="diagnose">
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Which component">
              {components.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
              <option value={TRAFFIC}>Traffic (no single component)</option>
            </select>
            <select value={type} onChange={(e) => setType(e.target.value as FaultType)} aria-label="What is wrong">
              {(Object.keys(FAULT_TYPES) as FaultType[]).map((t) => (
                <option key={t} value={t}>
                  {FAULT_TYPES[t].guess}
                </option>
              ))}
            </select>
            <button className="primary" onClick={() => onGuess(target === TRAFFIC ? null : target, type)}>
              Diagnose
            </button>
          </div>
          {wrong > 0 && (
            <p className="muted small">
              {wrong} wrong {wrong === 1 ? 'guess' : 'guesses'}: +{wrong * WRONG_GUESS_PENALTY} min on your time to detect.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="small ok-text">
            ✓ Diagnosed at {time(game.diagnosedAt)}: {fault.explanation}
          </p>
          {remedyReady === null ? (
            <button className="primary" onClick={onRemedy}>
              {fault.remedy}
            </button>
          ) : now < remedyReady ? (
            <p className="small">
              {fault.remedy}: rolling out, live at {time(remedyReady)}.
            </p>
          ) : (
            <p className="small">Fix is live. Waiting for {REMEDY_MINUTES} healthy minutes in a row…</p>
          )}
        </>
      )}
      <p className="muted small">You can also fix it by changing the design (adding replicas, capacity…).</p>
      <button className="link-button" onClick={onGiveUp}>
        Give up and reveal
      </button>
    </section>
  )
}

// ---- After the incident -------------------------------------------------------------------

export function Postmortem({
  open,
  onClose,
  onPlayAgain,
  game,
  design,
  metrics,
  incidents,
  rules,
  slo,
}: {
  open: boolean
  onClose: () => void
  onPlayAgain: () => void
  game: GameState | null
  design: Design
  metrics: MetricPoint[]
  incidents: AlertIncident[]
  rules: AlertRule[]
  slo: Slo
}) {
  if (!game || !isOver(game)) return null

  const fault = FAULT_TYPES[game.fault.type]
  const where = game.fault.target ? (getNode(design, game.fault.target)?.label ?? 'a deleted component') : 'traffic'
  const hurtAt = impactStartedAt(metrics, game.faultAt, slo)
  const firstPage = incidents.find(
    (i) => i.firedAt >= game.faultAt && rules.find((r) => r.id === i.ruleId)?.severity === 'page',
  )
  const wrong = game.guesses.filter((g) => !g.correct).length
  const ttd = game.diagnosedAt !== null ? game.diagnosedAt - game.faultAt + wrong * WRONG_GUESS_PENALTY : null
  const ttr = game.recoveredAt !== null ? game.recoveredAt - game.faultAt : null
  const used = budgetUsed(metrics, game.faultAt, game.recoveredAt ?? metrics[metrics.length - 1]?.t ?? game.faultAt, slo)
  const grade = ttr !== null ? recoveryGrade(ttr) : null
  const fixedByRemedy = game.remedyAt !== null && game.recoveredAt !== null && game.recoveredAt >= game.remedyAt
  // Giving up early can end the game before the fault even struck.
  const struck = (metrics[metrics.length - 1]?.t ?? game.startedAt) >= game.faultAt

  const timeline: [number | null, string][] = [
    [game.startedAt, 'Game day started'],
    [game.faultAt, `Fault injected: ${fault.label.toLowerCase()} on ${where}`],
    [hurtAt, 'Users started to notice (first moment outside the SLOs)'],
    [firstPage?.firedAt ?? null, `Paged: ${rules.find((r) => r.id === firstPage?.ruleId)?.name ?? ''}`],
    ...game.guesses.map(
      (g): [number, string] => [
        g.t,
        `${g.correct ? 'Correct diagnosis' : 'Wrong guess'}: ${g.target ? (getNode(design, g.target)?.label ?? g.target) : 'traffic'}, "${FAULT_TYPES[g.type].guess.toLowerCase()}"`,
      ],
    ),
    [game.remedyAt, `${fault.remedy} (rolling out)`],
    [game.recoveredAt, 'Recovered: healthy again'],
  ]

  return (
    <Modal open={open} onClose={onClose} title={game.gaveUp ? 'Postmortem: gave up' : 'Postmortem'}>
      <p className="callout">
        {struck ? (
          <>
            <b>What happened:</b> {fault.explanation} {game.fault.target && <>It hit <b>{where}</b>.</>}
          </>
        ) : (
          <>
            <b>It had not struck yet.</b> At {time(game.faultAt)} this would have happened:{' '}
            {fault.explanation.charAt(0).toLowerCase() + fault.explanation.slice(1)}{' '}
            {game.fault.target && <>The target was <b>{where}</b>.</>}
          </>
        )}
      </p>

      <dl className="stats postmortem-scores">
        <div>
          <dt>Time to detect</dt>
          <dd>{ttd !== null ? minutes(ttd) : '—'}</dd>
        </div>
        <div>
          <dt>Time to recover</dt>
          <dd>{ttr !== null ? minutes(ttr) : '—'}</dd>
        </div>
        <div>
          <dt>Error budget used</dt>
          <dd>{(used * 100).toFixed(1)}% of the month</dd>
        </div>
        <div>
          <dt>Verdict</dt>
          <dd>{grade ? grade.grade : 'Unresolved'}</dd>
        </div>
      </dl>
      {grade && <p className="muted small">{grade.note}</p>}

      <h3>Timeline</h3>
      <ol className="postmortem-timeline">
        {timeline
          .filter(([t]) => t !== null && (struck || t < game.faultAt))
          .sort((a, b) => a[0]! - b[0]!)
          .map(([t, label], i) => (
            <li key={i}>
              <span className="mono">{time(t!)}</span> {label}
            </li>
          ))}
      </ol>

      <h3>Lessons</h3>
      <ul className="postmortem-lessons small">
        <li>{fault.lesson}</li>
        <li>
          {firstPage
            ? `Your alerts paged ${minutes(firstPage.firedAt - game.faultAt)} after the fault.`
            : 'No alert paged during this incident. Would a different rule have caught it sooner?'}
        </li>
        {game.recoveredAt !== null && !fixedByRemedy && (
          <li>You recovered by changing the design, without rolling anything back: resilience beats heroics.</li>
        )}
        {wrong > 0 && (
          <li>
            {wrong} wrong {wrong === 1 ? 'guess' : 'guesses'}. Traces and per-component signals narrow it down before you
            act.
          </li>
        )}
      </ul>

      <div className="card-actions">
        <button className="primary" onClick={onPlayAgain}>
          Play again
        </button>
        <button onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}
