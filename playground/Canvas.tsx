import {
  addNode,
  bounds,
  catalog,
  connect,
  connectionError,
  getNode,
  isComponentKind,
  moveNode,
  totalOf,
  type Design,
  type DesignNode,
  type Point,
  type SimulationResult,
} from 'system-canvas'
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { KindIcon } from './icons'
import { formatPercent, formatRps, loadLevel } from './LoadStats'
import { Particles, type Flow } from './Particles'
import { KIND_MIME, type Selection } from './selection'

export const NODE_W = 172
export const NODE_H = 60
export const GRID = 20
const MIN_ZOOM = 0.2
const MAX_ZOOM = 2.5
const FIT_PADDING = 48

/** Screen position of the world origin, and how many screen pixels one world unit takes. */
interface Camera {
  x: number
  y: number
  zoom: number
}

export interface CanvasHandle {
  /** World point at the centre of the visible area, for placing new components. */
  viewCenter(): Point
  fit(): void
  /** The live <svg>, for exporting. */
  svg(): SVGSVGElement | null
}

/**
 * How the UI changes the design. `preview` + `commitFrom` make a drag one undo step, and
 * pushes sharing a `mergeKey` (typing, sliding) fold into one step until `settle`.
 */
export interface Editor {
  push(next: Design, mergeKey?: string): void
  preview(next: Design): void
  commitFrom(before: Design): void
  settle(): void
}

type Gesture =
  | { type: 'pan'; startX: number; startY: number; camera: Camera; moved: boolean }
  | { type: 'drag'; id: string; base: Design; offset: Point; moved: boolean }
  | { type: 'connect'; from: string }

interface Link {
  from: string
  to: Point
  target: string | null
  error: string | null
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export const snap = (p: Point): Point => ({ x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID })

/** Cubic curve from the right side of `a` to the left side of `b`. */
function curve(x1: number, y1: number, x2: number, y2: number): string {
  const bend = Math.max(40, Math.abs(x2 - x1) / 2)
  return `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`
}

const outPort = (node: DesignNode): Point => ({ x: node.position.x + NODE_W, y: node.position.y + NODE_H / 2 })
const inPort = (node: DesignNode): Point => ({ x: node.position.x, y: node.position.y + NODE_H / 2 })

/** Polyline with its corners rounded off by quadratic curves. */
function roundedPath(points: Point[], radius: number): string {
  let d = `M${points[0].x},${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const [prev, at, next] = [points[i - 1], points[i], points[i + 1]]
    const inLen = Math.hypot(at.x - prev.x, at.y - prev.y)
    const outLen = Math.hypot(next.x - at.x, next.y - at.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    if (r === 0) continue
    const start = { x: at.x - ((at.x - prev.x) / inLen) * r, y: at.y - ((at.y - prev.y) / inLen) * r }
    const end = { x: at.x + ((next.x - at.x) / outLen) * r, y: at.y + ((next.y - at.y) / outLen) * r }
    d += ` L${start.x},${start.y} Q${at.x},${at.y} ${end.x},${end.y}`
  }
  const last = points[points.length - 1]
  return `${d} L${last.x},${last.y}`
}

/**
 * Path for a connection, plus where to put its label. Forward connections are a smooth curve.
 * One pointing backwards (target left of the source) would loop through both boxes as a curve,
 * so it leaves to the right, travels along a lane between or below the two components, and
 * enters the target from the left.
 */
function edgeRoute(a: DesignNode, b: DesignNode): { d: string; mid: Point } {
  const p1 = outPort(a)
  const p2 = inPort(b)
  if (p2.x - p1.x >= 40) {
    return { d: curve(p1.x, p1.y, p2.x, p2.y), mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } }
  }
  const stub = 24
  const aTop = a.position.y
  const bTop = b.position.y
  let lane: number
  if (aTop + NODE_H + 30 <= bTop) lane = (aTop + NODE_H + bTop) / 2
  else if (bTop + NODE_H + 30 <= aTop) lane = (bTop + NODE_H + aTop) / 2
  else lane = Math.max(aTop, bTop) + NODE_H + 30
  const right = p1.x + stub
  const left = p2.x - stub
  return {
    d: roundedPath(
      [p1, { x: right, y: p1.y }, { x: right, y: lane }, { x: left, y: lane }, { x: left, y: p2.y }, p2],
      14,
    ),
    mid: { x: (right + left) / 2, y: lane },
  }
}

function nodeAt(design: Design, p: Point): DesignNode | undefined {
  // Last drawn is on top, so search backwards.
  for (let i = design.nodes.length - 1; i >= 0; i--) {
    const { x, y } = design.nodes[i].position
    if (p.x >= x && p.x <= x + NODE_W && p.y >= y && p.y <= y + NODE_H) return design.nodes[i]
  }
  return undefined
}

export function Canvas({
  design,
  selection,
  onSelect,
  editor,
  notice,
  notify,
  sim,
  failed,
  spofs,
  overlay,
  ref,
}: {
  design: Design
  selection: Selection
  onSelect: (selection: Selection) => void
  editor: Editor
  /** Short message shown over the canvas (refused connections, import results). */
  notice: string | null
  notify: (message: string) => void
  /** Live traffic to draw (heat, flowing requests), or null when not simulating. */
  sim: SimulationResult | null
  /** Components switched off by failure injection. */
  failed: ReadonlySet<string>
  /** Single points of failure to tag (only while simulating). */
  spofs: string[]
  /** Extra UI floating over the canvas (the metrics panel). */
  overlay?: ReactNode
  ref?: Ref<CanvasHandle>
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const gesture = useRef<Gesture | null>(null)
  /** Rendered connection paths, which the particles follow. */
  const paths = useRef(new Map<string, SVGPathElement>())
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 })
  const [link, setLink] = useState<Link | null>(null)
  const [panning, setPanning] = useState(false)

  const rect = () => svgRef.current!.getBoundingClientRect()
  const toWorld = (clientX: number, clientY: number): Point => {
    const r = rect()
    return { x: (clientX - r.left - camera.x) / camera.zoom, y: (clientY - r.top - camera.y) / camera.zoom }
  }

  const fit = () => {
    const r = rect()
    const box = bounds(design)
    if (!box || r.width === 0) {
      setCamera({ x: r.width / 2, y: r.height / 2, zoom: 1 })
      return
    }
    const w = box.maxX - box.minX + NODE_W
    const h = box.maxY - box.minY + NODE_H
    const zoom = clamp(Math.min((r.width - FIT_PADDING * 2) / w, (r.height - FIT_PADDING * 2) / h), MIN_ZOOM, 1.25)
    setCamera({
      x: (r.width - w * zoom) / 2 - box.minX * zoom,
      y: (r.height - h * zoom) / 2 - box.minY * zoom,
      zoom,
    })
  }

  /** Zoom by `factor`, keeping the world point under screen point (sx, sy) fixed. */
  const zoomAt = (factor: number, sx: number, sy: number) =>
    setCamera((c) => {
      const zoom = clamp(c.zoom * factor, MIN_ZOOM, MAX_ZOOM)
      const k = zoom / c.zoom
      return { zoom, x: sx - (sx - c.x) * k, y: sy - (sy - c.y) * k }
    })

  const zoomCenter = (factor: number) => {
    const r = rect()
    zoomAt(factor, r.width / 2, r.height / 2)
  }

  useImperativeHandle(ref, () => ({
    viewCenter: () => {
      const r = rect()
      return toWorld(r.left + r.width / 2, r.top + r.height / 2)
    },
    fit,
    svg: () => svgRef.current,
  }))

  // Frame the design once the canvas has its real size. In dev the stylesheet arrives after
  // the first render, so measuring in a layout effect would see the SVG's 300×150 default.
  const fitRef = useRef(fit)
  fitRef.current = fit
  useEffect(() => {
    const svg = svgRef.current!
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width < 50 || entry.contentRect.height < 50) return
      fitRef.current()
      observer.disconnect()
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  // React's onWheel is passive, so preventDefault (to stop page scroll) needs a manual listener.
  useEffect(() => {
    const svg = svgRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = svg.getBoundingClientRect()
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  // ---- Gestures --------------------------------------------------------------

  const capture = (e: PointerEvent) => svgRef.current!.setPointerCapture(e.pointerId)

  const onBackgroundDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    capture(e)
    gesture.current = { type: 'pan', startX: e.clientX, startY: e.clientY, camera, moved: false }
  }

  const onNodeDown = (e: PointerEvent, node: DesignNode) => {
    if (e.button !== 0) return
    e.stopPropagation()
    capture(e)
    onSelect({ type: 'node', id: node.id })
    const p = toWorld(e.clientX, e.clientY)
    gesture.current = {
      type: 'drag',
      id: node.id,
      base: design,
      offset: { x: p.x - node.position.x, y: p.y - node.position.y },
      moved: false,
    }
  }

  const onPortDown = (e: PointerEvent, node: DesignNode) => {
    if (e.button !== 0) return
    e.stopPropagation()
    capture(e)
    gesture.current = { type: 'connect', from: node.id }
    setLink({ from: node.id, to: toWorld(e.clientX, e.clientY), target: null, error: null })
  }

  const onEdgeDown = (e: PointerEvent, id: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    onSelect({ type: 'edge', id })
  }

  const onMove = (e: PointerEvent) => {
    const g = gesture.current
    if (!g) return
    if (g.type === 'pan') {
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      if (!g.moved && Math.hypot(dx, dy) < 3) return
      if (!g.moved) setPanning(true)
      g.moved = true
      setCamera({ ...g.camera, x: g.camera.x + dx, y: g.camera.y + dy })
    } else if (g.type === 'drag') {
      const p = toWorld(e.clientX, e.clientY)
      const position = snap({ x: p.x - g.offset.x, y: p.y - g.offset.y })
      const current = getNode(design, g.id)!.position
      if (position.x === current.x && position.y === current.y) return
      g.moved = true
      editor.preview(moveNode(g.base, g.id, position))
    } else {
      const to = toWorld(e.clientX, e.clientY)
      const hit = nodeAt(design, to)
      const target = hit && hit.id !== g.from ? hit.id : null
      setLink({ from: g.from, to, target, error: target ? connectionError(design, g.from, target) : null })
    }
  }

  const onUp = () => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    if (g.type === 'pan') {
      setPanning(false)
      if (!g.moved) onSelect(null)
    } else if (g.type === 'drag') {
      if (g.moved) editor.commitFrom(g.base)
    } else if (link) {
      if (link.target && !link.error) {
        const result = connect(design, link.from, link.target)
        editor.push(result.design)
        onSelect({ type: 'edge', id: result.edge.id })
      } else if (link.error) {
        notify(link.error)
      }
      setLink(null)
    }
  }

  // ---- Drop from the palette ---------------------------------------------------

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(KIND_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDrop = (e: DragEvent) => {
    const kind = e.dataTransfer.getData(KIND_MIME)
    if (!isComponentKind(kind)) return
    e.preventDefault()
    const p = toWorld(e.clientX, e.clientY)
    const result = addNode(design, kind, snap({ x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 }))
    editor.push(result.design)
    onSelect({ type: 'node', id: result.node.id })
  }

  // ---- Render ------------------------------------------------------------------

  const selectedNode = selection?.type === 'node' ? selection.id : null
  const selectedEdge = selection?.type === 'edge' ? selection.id : null
  const linkFrom = link ? getNode(design, link.from) : undefined
  const svgClass = ['canvas', panning && 'panning', link && 'connecting', sim && 'simulating']
    .filter(Boolean)
    .join(' ')

  // Line width grows with the log of traffic, relative to the busiest connection.
  const maxRps = sim ? Math.max(1, ...Object.values(sim.edges).map((e) => totalOf(e.traffic))) : 1
  const edgeWidth = (rps: number) => 1.5 + (4 * Math.log10(1 + rps)) / Math.log10(1 + maxRps)
  const flows: Flow[] = sim
    ? design.edges
        .map((edge) => ({ edge, stats: sim.edges[edge.id] }))
        .filter(({ stats }) => !stats.ignored && totalOf(stats.traffic) > 0.01)
        .map(({ edge, stats }) => ({
          id: edge.id,
          rps: totalOf(stats.traffic),
          writeShare: stats.traffic.writes / totalOf(stats.traffic),
          async: stats.async,
        }))
    : []

  return (
    <main className="canvas-wrap" onDragOver={onDragOver} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className={svgClass}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="application"
        aria-label={`${design.name} canvas`}
      >
        <defs>
          <pattern
            id="dots"
            width={GRID * camera.zoom}
            height={GRID * camera.zoom}
            x={camera.x}
            y={camera.y}
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="1" className="grid-dot" />
          </pattern>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="arrow-head" />
          </marker>
          <marker id="arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="arrow-head active" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />

        <g className="viewport" transform={`translate(${camera.x},${camera.y}) scale(${camera.zoom})`}>
          <g className="edges">
            {design.edges.map((edge) => {
              const a = getNode(design, edge.from)
              const b = getNode(design, edge.to)
              if (!a || !b) return null
              const { d, mid } = edgeRoute(a, b)
              const selected = edge.id === selectedEdge
              const active = selected || edge.from === selectedNode || edge.to === selectedNode
              const stats = sim?.edges[edge.id]
              const rps = stats ? totalOf(stats.traffic) : 0
              const label = stats
                ? [edge.label, stats.ignored ? 'loop, ignored' : `${formatRps(rps)}/s`].filter(Boolean).join(' · ')
                : edge.label
              const className = [
                'edge',
                active && 'active',
                selected && 'selected',
                stats?.async && 'async',
                stats && (stats.ignored || rps < 0.01) && 'idle',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <g key={edge.id} className={className} onPointerDown={(e) => onEdgeDown(e, edge.id)}>
                  <path className="edge-hit" d={d} />
                  <path
                    ref={(el) => {
                      if (el) paths.current.set(edge.id, el)
                      else paths.current.delete(edge.id)
                    }}
                    className="edge-line"
                    d={d}
                    strokeWidth={stats && !stats.ignored ? edgeWidth(rps) : undefined}
                    markerEnd={active ? 'url(#arrow-active)' : 'url(#arrow)'}
                  />
                  {label && (
                    <text x={mid.x} y={mid.y - 8} textAnchor="middle" className="edge-label">
                      {label}
                    </text>
                  )}
                </g>
              )
            })}
            {link && linkFrom && (
              <path
                className={['link-preview', link.error && 'invalid'].filter(Boolean).join(' ')}
                d={curve(outPort(linkFrom).x, outPort(linkFrom).y, link.to.x, link.to.y)}
              />
            )}
          </g>

          {sim && <Particles flows={flows} paths={paths.current} />}

          <g className="nodes">
            {design.nodes.map((node) => {
              const spec = catalog[node.kind]
              const isTarget = link?.target === node.id
              const stats = sim?.nodes[node.id]
              const down = failed.has(node.id)
              const measured =
                stats && !down && node.kind !== 'client' && Number.isFinite(stats.capacity.reads)
              const idle = stats && node.kind !== 'client' && totalOf(stats.load) === 0
              const className = [
                'node',
                node.id === selectedNode && 'selected',
                isTarget && (link?.error ? 'drop-bad' : 'drop-ok'),
                measured && !idle && `heat-${loadLevel(stats.utilization)}`,
                stats?.overloaded && 'overloaded',
                idle && !down && 'idle',
                down && 'failed',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <g
                  key={node.id}
                  className={className}
                  data-category={spec.category}
                  transform={`translate(${node.position.x},${node.position.y})`}
                  onPointerDown={(e) => onNodeDown(e, node)}
                >
                  <rect className="node-body" width={NODE_W} height={NODE_H} rx="12" />
                  <rect className="node-stripe" width="6" height={NODE_H - 20} x="0" y="10" rx="3" />
                  <g transform="translate(18,18)" className="node-icon">
                    <KindIcon kind={node.kind} size={24} />
                  </g>
                  <text x="54" y="27" className="node-label">
                    {node.label.length > 15 ? `${node.label.slice(0, 14)}…` : node.label}
                  </text>
                  <text x="54" y="44" className="node-kind">
                    {spec.label}
                    {node.params.replicas > 1 ? ` × ${node.params.replicas}` : ''}
                  </text>
                  {stats && node.kind === 'client' && (
                    <text x={NODE_W - 10} y="18" textAnchor="end" className="node-metric">
                      {formatRps(totalOf(stats.load))} rps
                    </text>
                  )}
                  {stats && measured && !idle && (
                    <>
                      <text x={NODE_W - 10} y="18" textAnchor="end" className="node-metric level">
                        {formatPercent(stats.utilization)}
                      </text>
                      <rect className="util-track" x="12" y={NODE_H - 8} width={NODE_W - 24} height="3" rx="1.5" />
                      <rect
                        className="util-bar"
                        x="12"
                        y={NODE_H - 8}
                        width={(NODE_W - 24) * Math.min(1, stats.utilization)}
                        height="3"
                        rx="1.5"
                      />
                    </>
                  )}
                  {spofs.includes(node.id) && !down && (
                    <g className="spof-mark" transform="translate(10,-9)">
                      <rect width="38" height="16" rx="4" />
                      <text x="19" y="12" textAnchor="middle">
                        SPOF
                      </text>
                      <title>Single point of failure</title>
                    </g>
                  )}
                  {down && (
                    <>
                      <path className="down-cross" d={`M${NODE_W - 22},10 l12,12 m0,-12 l-12,12`} />
                      <text x={NODE_W / 2} y={NODE_H + 17} textAnchor="middle" className="node-badge">
                        DOWN
                        {stats && stats.dropped + stats.backlog > 0.5
                          ? ` · losing ${formatRps(stats.dropped + stats.backlog)} rps`
                          : ''}
                      </text>
                    </>
                  )}
                  {!down && stats && (stats.dropped > 0.5 || stats.backlog > 0.5) && (
                    <text x={NODE_W / 2} y={NODE_H + 17} textAnchor="middle" className="node-badge">
                      {stats.dropped > 0.5
                        ? `dropping ${formatRps(stats.dropped)} rps`
                        : `backlog +${formatRps(stats.backlog)}/s`}
                    </text>
                  )}
                  {spec.acceptsIncoming && <circle className="port in" cx="0" cy={NODE_H / 2} r="5" />}
                  <circle
                    className="port out"
                    cx={NODE_W}
                    cy={NODE_H / 2}
                    r="6"
                    onPointerDown={(e) => onPortDown(e, node)}
                  >
                    <title>Drag to connect</title>
                  </circle>
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      {design.nodes.length === 0 && (
        <p className="canvas-empty">Drag a component here from the palette, or click one to add it.</p>
      )}

      {notice && (
        <p className="toast" role="status">
          {notice}
        </p>
      )}

      <div className="zoom-bar">
        <button onClick={() => zoomCenter(1 / 1.2)} aria-label="Zoom out">
          −
        </button>
        <span className="zoom-value">{Math.round(camera.zoom * 100)}%</span>
        <button onClick={() => zoomCenter(1.2)} aria-label="Zoom in">
          +
        </button>
        <button onClick={fit}>Fit</button>
      </div>

      {overlay}
    </main>
  )
}
