// Keeps the site's built-in content honest: every template runs healthy, and every challenge
// starts broken but has a reference solution that meets all of its goals.

import { describe, expect, it } from 'vitest'
import { evaluateGoals, parseDesign, serializeDesign, simulate } from 'system-canvas'
import { challenges } from '../playground/challenges'
import { templates } from '../playground/templates'

const failing = (results: { label: string; passed: boolean; actual: string }[]) =>
  results.filter((r) => !r.passed).map((r) => `${r.label}: ${r.actual}`)

describe('templates', () => {
  it('have unique ids', () => {
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length)
  })

  for (const template of templates) {
    describe(template.name, () => {
      const design = template.build()

      it('round-trips through JSON and carries notes', () => {
        expect(parseDesign(serializeDesign(design))).toEqual(design)
        expect(design.notes?.length).toBeGreaterThan(50)
      })

      it('runs healthy: nothing overloaded, idle, looping or backed up', () => {
        const sim = simulate(design)
        const busiest = sim.bottleneck ? sim.nodes[sim.bottleneck].utilization : 0
        expect(sim.warnings).toEqual([])
        expect(sim.overloaded).toEqual([])
        expect(sim.backlogRps).toBe(0)
        expect(busiest).toBeLessThan(0.85)
      })
    })
  }
})

describe('challenges', () => {
  it('have unique ids and at least two hints each', () => {
    expect(new Set(challenges.map((c) => c.id)).size).toBe(challenges.length)
    for (const c of challenges) expect(c.hints.length, c.id).toBeGreaterThanOrEqual(2)
  })

  for (const challenge of challenges) {
    describe(challenge.name, () => {
      it('starts out failing', () => {
        expect(evaluateGoals(challenge.start(), challenge.goals).passed).toBe(false)
      })

      it('has a reference solution that meets every goal', () => {
        const { results } = evaluateGoals(challenge.solution(), challenge.goals)
        expect(failing(results)).toEqual([])
      })
    })
  }
})
