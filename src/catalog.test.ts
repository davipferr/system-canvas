import { describe, expect, it } from 'vitest'
import { catalog, categories, clampParam, componentKinds, defaultParams, specsInCategory } from 'system-canvas'

describe('catalog', () => {
  it('keys every spec by its own kind', () => {
    for (const kind of componentKinds) expect(catalog[kind].kind).toBe(kind)
  })

  it('puts every component in a known category', () => {
    const total = categories.reduce((sum, c) => sum + specsInCategory(c.id).length, 0)
    expect(total).toBe(componentKinds.length)
  })

  it('has sane parameter ranges with defaults inside them', () => {
    for (const kind of componentKinds) {
      const keys = new Set<string>()
      for (const p of catalog[kind].params) {
        expect(keys.has(p.key), `${kind}.${p.key} duplicated`).toBe(false)
        keys.add(p.key)
        expect(p.min).toBeLessThan(p.max)
        expect(p.step).toBeGreaterThan(0)
        expect(p.default).toBeGreaterThanOrEqual(p.min)
        expect(p.default).toBeLessThanOrEqual(p.max)
        expect(clampParam(p, p.default)).toBe(p.default)
      }
    }
  })

  it('only clients refuse incoming calls', () => {
    const refusing = componentKinds.filter((kind) => !catalog[kind].acceptsIncoming)
    expect(refusing).toEqual(['client'])
  })

  it('builds default params from the spec', () => {
    expect(defaultParams('service')).toEqual({ latency: 30, capacity: 500, replicas: 3, availability: 99.5 })
  })
})

describe('clampParam', () => {
  const spec = { key: 'x', label: 'X', min: 1, max: 10, step: 0.5, default: 2 }

  it('clamps to the range', () => {
    expect(clampParam(spec, -5)).toBe(1)
    expect(clampParam(spec, 99)).toBe(10)
  })

  it('snaps to the step', () => {
    expect(clampParam(spec, 3.2)).toBe(3)
    expect(clampParam(spec, 3.3)).toBe(3.5)
  })

  it('falls back to the default for NaN and Infinity', () => {
    expect(clampParam(spec, Number.NaN)).toBe(2)
    expect(clampParam(spec, Number.POSITIVE_INFINITY)).toBe(2)
  })

  it('does not leak floating point noise', () => {
    expect(clampParam({ ...spec, min: 0.1, step: 0.1 }, 0.3)).toBe(0.3)
  })
})
