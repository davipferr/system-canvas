import { useState } from 'react'
import type { GoalResult } from 'system-canvas'
import type { Challenge } from './challenges'
import { formatRps } from './LoadStats'

export function ChallengePanel({
  challenge,
  results,
  passed,
  onShowSolution,
  onLeave,
}: {
  challenge: Challenge
  results: GoalResult[]
  passed: boolean
  onShowSolution: () => void
  onLeave: () => void
}) {
  // Hints are revealed one by one; a new challenge starts with none shown (the panel is keyed by id).
  const [hints, setHints] = useState(0)
  const goals = results.filter((r) => r.id !== 'client' || !r.passed)
  const done = goals.filter((r) => r.passed).length

  return (
    <details className={passed ? 'challenge passed' : 'challenge'} open>
      <summary>
        <span className="challenge-label">Challenge</span>
        <b>{challenge.name}</b>
        <span className="muted">
          {done}/{goals.length}
        </span>
      </summary>
      <div className="challenge-body">
        {passed ? (
          <p className="callout ok-box">
            <b>Challenge complete!</b> Every goal passes. Try breaking it again with Simulate, or pick another
            challenge from the Library.
          </p>
        ) : (
          <p className="small">{challenge.brief}</p>
        )}
        <p className="muted small">
          Traffic is fixed by the challenge: {formatRps(challenge.goals.rps)} rps, {challenge.goals.readRatio}% reads.
        </p>
        <ul className="goals">
          {goals.map((r) => (
            <li key={r.id} className={r.passed ? 'goal ok' : 'goal fail'}>
              <span className="goal-mark" aria-label={r.passed ? 'passed' : 'not yet'}>
                {r.passed ? '✓' : '✗'}
              </span>
              <span>
                {r.label}
                <span className="goal-actual">{r.actual}</span>
              </span>
            </li>
          ))}
        </ul>
        {challenge.hints.slice(0, hints).map((hint, i) => (
          <p key={i} className="hint small">
            <b>Hint {i + 1}.</b> {hint}
          </p>
        ))}
        <div className="challenge-actions">
          {hints < challenge.hints.length && !passed && (
            <button onClick={() => setHints((n) => n + 1)}>
              Hint ({hints + 1}/{challenge.hints.length})
            </button>
          )}
          <button onClick={onShowSolution} title="Replace the canvas with a reference solution (undoable)">
            Show a solution
          </button>
          <button onClick={onLeave}>Leave</button>
        </div>
      </div>
    </details>
  )
}
