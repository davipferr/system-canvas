// Undo/redo as plain data. Because every design operation returns a new value, history is
// just the list of earlier values (`past`) and the ones you undid (`future`).
//
// Continuous gestures such as dragging a node use two steps: `preview` swaps the present
// on every pointer move without recording anything, and `commitFrom(before)` records the
// state from before the gesture once it ends. One drag is then one undo step.
//
// Typing a name or nudging a slider is a stream of separate changes instead. Passing the
// same `mergeKey` to consecutive `push` calls folds them into one undo step, until
// anything else happens (another key, undo, redo, a gesture) or `settle` is called.

export interface History<T> {
  past: T[]
  present: T
  future: T[]
  /** Key of the last push, while later pushes with the same key may still merge into it. */
  mergeKey?: string
}

export const HISTORY_LIMIT = 100

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/** Record a new state. Redo is no longer possible after a fresh change. */
export function push<T>(history: History<T>, next: T, mergeKey?: string): History<T> {
  if (next === history.present) return history
  if (mergeKey !== undefined && mergeKey === history.mergeKey) {
    return { past: history.past, present: next, future: [], mergeKey }
  }
  return { past: trim([...history.past, history.present]), present: next, future: [], mergeKey }
}

/** Stop merging: the next push starts a new undo step even with the same key. */
export function settle<T>(history: History<T>): History<T> {
  if (history.mergeKey === undefined) return history
  return { past: history.past, present: history.present, future: history.future }
}

/** Swap the present without recording an undo step (for in-progress gestures). */
export function preview<T>(history: History<T>, next: T): History<T> {
  return { ...history, present: next }
}

/** End a gesture that started at `before`: one undo step takes you back to it. */
export function commitFrom<T>(history: History<T>, before: T): History<T> {
  if (before === history.present) return history
  return { past: trim([...history.past, before]), present: history.present, future: [] }
}

export function undo<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
  }
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history
  return {
    past: trim([...history.past, history.present]),
    present: history.future[0],
    future: history.future.slice(1),
  }
}

function trim<T>(past: T[]): T[] {
  return past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past
}
