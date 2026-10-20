import { useEffect, useState } from 'react'
import { CLOCK_START, patternMultiplier, type TrafficPattern } from 'system-canvas'

/** Real seconds between ticks. Each tick advances simulated time by `speed × TICK_SECONDS` minutes. */
export const TICK_SECONDS = 0.25

/** Simulated minutes per real second. */
export const CLOCK_SPEEDS = [
  { value: 1, label: '1 min/s' },
  { value: 10, label: '10 min/s' },
  { value: 60, label: '1 h/s' },
]

/** A simulated clock that only runs while `active` (Simulate mode) and not paused. */
export function useClock(active: boolean) {
  const [running, setRunning] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [pattern, setPattern] = useState<TrafficPattern>('steady')
  const [t, setT] = useState(CLOCK_START)

  useEffect(() => {
    if (!active || !running) return
    const timer = setInterval(() => setT((now) => now + speed * TICK_SECONDS), TICK_SECONDS * 1000)
    return () => clearInterval(timer)
  }, [active, running, speed])

  return {
    running,
    setRunning,
    speed,
    setSpeed,
    pattern,
    setPattern,
    t,
    reset: () => setT(CLOCK_START),
    /** How much the pattern scales traffic right now. */
    multiplier: patternMultiplier(pattern, t),
  }
}

export type Clock = ReturnType<typeof useClock>
