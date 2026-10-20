import { useState } from 'react'
import type { Goals } from 'system-canvas'
import type { Challenge } from './challenges'
import { challenges } from './challenges'
import { formatRps } from './LoadStats'
import { Modal } from './Modal'
import { templates, type Template } from './templates'

type Tab = 'templates' | 'challenges'

/** Short chips summarising what a challenge asks for. */
function goalChips(goals: Goals): string[] {
  const chips = [`${formatRps(goals.rps)} rps`]
  if (goals.maxResponseTime !== undefined) chips.push(`< ${goals.maxResponseTime} ms`)
  if (goals.minAvailability !== undefined) chips.push(`≥ ${(goals.minAvailability * 100).toFixed(2)}% up`)
  if (goals.noSpof) chips.push('no SPOF')
  if (goals.noBacklog) chips.push('no backlog')
  if (goals.maxUtilization !== undefined) chips.push(`≤ ${goals.maxUtilization * 100}% busy`)
  if (goals.maxCost !== undefined) chips.push(`≤ $${goals.maxCost.toLocaleString('en-US')}/mo`)
  return chips
}

export function Library({
  open,
  onClose,
  onOpenTemplate,
  onStartChallenge,
  completed,
}: {
  open: boolean
  onClose: () => void
  onOpenTemplate: (template: Template) => void
  onStartChallenge: (challenge: Challenge) => void
  completed: ReadonlySet<string>
}) {
  const [tab, setTab] = useState<Tab>('templates')

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Library"
      headerExtra={
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'templates'} onClick={() => setTab('templates')}>
            Templates
          </button>
          <button role="tab" aria-selected={tab === 'challenges'} onClick={() => setTab('challenges')}>
            Challenges
          </button>
        </div>
      }
    >
      {tab === 'templates' ? (
        <>
          <p className="muted small">
            Classic designs to study and take apart. Opening one replaces the canvas (you can undo).
          </p>
          <ul className="cards">
            {templates.map((t) => (
              <li key={t.id} className="card-item">
                <h3>{t.name}</h3>
                <p className="small">{t.summary}</p>
                <div className="chips">
                  {t.concepts.map((c) => (
                    <span key={c} className="tag">
                      {c}
                    </span>
                  ))}
                </div>
                <button className="primary" onClick={() => onOpenTemplate(t)}>
                  Open
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="muted small">
            Fix a broken design until every goal passes. The challenge sets the traffic, so you have to change
            the design itself.
          </p>
          <ul className="cards">
            {challenges.map((c) => (
              <li key={c.id} className="card-item">
                <div className="card-title">
                  <h3>{c.name}</h3>
                  <span className={`difficulty ${c.difficulty}`}>{c.difficulty}</span>
                </div>
                <p className="small">{c.brief}</p>
                <div className="chips">
                  {goalChips(c.goals).map((g) => (
                    <span key={g} className="tag">
                      {g}
                    </span>
                  ))}
                </div>
                <div className="card-actions">
                  <button className="primary" onClick={() => onStartChallenge(c)}>
                    {completed.has(c.id) ? 'Play again' : 'Start'}
                  </button>
                  {completed.has(c.id) && <span className="done">✓ Completed</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  )
}
