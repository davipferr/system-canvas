import { describe, expect, it } from 'vitest'
import { commitFrom, createHistory, HISTORY_LIMIT, preview, push, redo, settle, undo } from 'system-canvas'

describe('history', () => {
  it('undoes and redoes pushed states', () => {
    let h = push(push(createHistory('a'), 'b'), 'c')
    h = undo(h)
    expect(h.present).toBe('b')
    h = undo(h)
    expect(h.present).toBe('a')
    expect(undo(h)).toBe(h) // nothing left to undo
    h = redo(redo(h))
    expect(h.present).toBe('c')
    expect(redo(h)).toBe(h)
  })

  it('drops the redo stack after a new change', () => {
    const h = push(undo(push(createHistory(1), 2)), 3)
    expect(h).toEqual({ past: [1], present: 3, future: [] })
  })

  it('ignores pushing the same value', () => {
    const h = createHistory('a')
    expect(push(h, 'a')).toBe(h)
  })

  it('turns a whole gesture into one undo step', () => {
    let h = createHistory({ x: 0 })
    const before = h.present
    for (let x = 1; x <= 5; x++) h = preview(h, { x })
    expect(h.past).toEqual([])
    h = commitFrom(h, before)
    expect(h.present).toEqual({ x: 5 })
    expect(undo(h).present).toBe(before)
  })

  it('records nothing for a gesture that changed nothing', () => {
    const h = createHistory('a')
    expect(commitFrom(h, h.present)).toBe(h)
  })

  it('keeps at most HISTORY_LIMIT undo steps', () => {
    let h = createHistory(0)
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = push(h, i)
    expect(h.past).toHaveLength(HISTORY_LIMIT)
    expect(h.past[0]).toBe(20)
  })

  it('merges consecutive pushes with the same key into one undo step', () => {
    let h = createHistory('')
    for (const text of ['A', 'AP', 'API']) h = push(h, text, 'rename:node-1')
    expect(h.past).toEqual([''])
    expect(undo(h).present).toBe('')
  })

  it('stops merging on a different key, an undo or settle', () => {
    let h = push(push(createHistory(0), 1, 'a'), 2, 'b')
    expect(h.past).toEqual([0, 1])
    h = push(settle(h), 3, 'b')
    expect(h.past).toEqual([0, 1, 2])
    h = push(undo(h), 4, 'b')
    expect(h.past).toEqual([0, 1, 2])
    expect(h.present).toBe(4)
    expect(push(h, 5, 'b').past).toEqual([0, 1, 2]) // merging resumes after a keyed push
  })
})
