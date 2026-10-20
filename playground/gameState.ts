import { REMEDY_MINUTES, type Fault, type FaultType } from 'system-canvas'

export interface Guess {
  t: number
  target: string | null
  type: FaultType
  correct: boolean
}

/** A game day in progress (or just finished). Times are simulated minutes. */
export interface GameState {
  fault: Fault
  startedAt: number
  /** When the hidden fault hits: a few minutes after the start, so the player cannot time it. */
  faultAt: number
  guesses: Guess[]
  diagnosedAt: number | null
  /** When the player applied the remedy; it takes effect REMEDY_MINUTES later. */
  remedyAt: number | null
  recoveredAt: number | null
  gaveUp: boolean
}

export const isOver = (game: GameState) => game.recoveredAt !== null || game.gaveUp

/** Is the fault shaping the simulation at simulated time `t`? */
export function isFaultActive(game: GameState | null, t: number): boolean {
  if (!game || isOver(game) || t < game.faultAt) return false
  return game.remedyAt === null || t < game.remedyAt + REMEDY_MINUTES
}
