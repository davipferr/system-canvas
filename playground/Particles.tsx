import { useEffect, useRef } from 'react'

export interface Flow {
  id: string
  rps: number
  /** Fraction of the traffic that is writes; that share of the dots is drawn in the write colour. */
  writeShare: number
  async: boolean
}

/** World units per second. Constant speed, so long connections take longer to cross. */
const SPEED = 140

/** 1 dot for a trickle, up to 8 for heavy traffic: the log keeps 10 rps and 100k rps both readable. */
export function dotCount(rps: number): number {
  return Math.max(1, Math.min(8, Math.round(1 + Math.log10(1 + rps) * 1.5)))
}

/**
 * Requests flowing along connections. React only renders the dots once per traffic change;
 * a requestAnimationFrame loop moves them by writing cx/cy straight onto the elements, so
 * the animation never re-renders the canvas.
 */
export function Particles({ flows, paths }: { flows: Flow[]; paths: Map<string, SVGPathElement> }) {
  const group = useRef<SVGGElement>(null)

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    const tick = (now: number) => {
      const lengths = new Map<string, number>()
      for (const dot of group.current?.children ?? []) {
        const edgeId = dot.getAttribute('data-edge')!
        const path = paths.get(edgeId)
        if (!path) continue
        let length = lengths.get(edgeId)
        if (length === undefined) {
          length = path.getTotalLength()
          lengths.set(edgeId, length)
        }
        const offset = Number(dot.getAttribute('data-offset'))
        const travelled = reduceMotion ? 0 : (now / 1000) * SPEED
        const t = (travelled / Math.max(length, 1) + offset) % 1
        const point = path.getPointAtLength(t * length)
        dot.setAttribute('cx', String(point.x))
        dot.setAttribute('cy', String(point.y))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [paths])

  return (
    <g ref={group} className="particles" aria-hidden="true">
      {flows.flatMap((flow) => {
        const count = dotCount(flow.rps)
        const writes = flow.writeShare > 0 ? Math.max(1, Math.round(count * flow.writeShare)) : 0
        return Array.from({ length: count }, (_, i) => (
          <circle
            key={`${flow.id}:${i}`}
            data-edge={flow.id}
            data-offset={i / count}
            r={3.2}
            // Exactly `writes` write dots, spread evenly through the stream rather than bunched.
            className={[
              'dot',
              Math.floor(((i + 1) * writes) / count) > Math.floor((i * writes) / count) ? 'write' : 'read',
              flow.async && 'async',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        ))
      })}
    </g>
  )
}
