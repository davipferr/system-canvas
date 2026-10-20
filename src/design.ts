// A design is a directed graph: components (nodes) and the calls between them (edges).
// Every operation here is pure and returns a new Design, which makes undo/redo a
// matter of keeping old values around and keeps the editor easy to test.

import { catalog, clampParam, defaultParams, isComponentKind, type ComponentKind } from './catalog'
import { normalizeSlo, type Slo } from './sre'

export interface Point {
  x: number
  y: number
}

export interface DesignNode {
  id: string
  kind: ComponentKind
  label: string
  position: Point
  params: Record<string, number>
}

export interface DesignEdge {
  id: string
  from: string
  to: string
  /** Optional note such as "reads", "writes" or "async". */
  label?: string
}

export interface Design {
  version: 1
  name: string
  /** Free-form notes: requirements, decisions, trade-offs. */
  notes?: string
  /** Service level objectives; `DEFAULT_SLO` applies when absent. */
  slo?: Slo
  nodes: DesignNode[]
  edges: DesignEdge[]
}

export function createDesign(name = 'Untitled system'): Design {
  return { version: 1, name, nodes: [], edges: [] }
}

/** Next free id with a prefix: `node-1`, `node-2`... Deterministic, so tests can predict it. */
export function nextId(design: Design, prefix: 'node' | 'edge'): string {
  const items: { id: string }[] = prefix === 'node' ? design.nodes : design.edges
  let max = 0
  for (const { id } of items) {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`))
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `${prefix}-${max + 1}`
}

/** `base`, or `base 2`, `base 3`... whichever is not taken yet. */
export function uniqueLabel(design: Design, base: string): string {
  const taken = new Set(design.nodes.map((node) => node.label))
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

export function getNode(design: Design, id: string): DesignNode | undefined {
  return design.nodes.find((node) => node.id === id)
}

export function addNode(
  design: Design,
  kind: ComponentKind,
  position: Point,
  overrides: { id?: string; label?: string; params?: Record<string, number> } = {},
): { design: Design; node: DesignNode } {
  const node: DesignNode = {
    id: overrides.id ?? nextId(design, 'node'),
    kind,
    label: overrides.label ?? uniqueLabel(design, catalog[kind].label),
    position,
    params: sanitizeParams(kind, overrides.params ?? {}),
  }
  if (getNode(design, node.id)) throw new Error(`Duplicate node id "${node.id}"`)
  return { design: { ...design, nodes: [...design.nodes, node] }, node }
}

/** Removes the node and every edge touching it. */
export function removeNode(design: Design, id: string): Design {
  return {
    ...design,
    nodes: design.nodes.filter((node) => node.id !== id),
    edges: design.edges.filter((edge) => edge.from !== id && edge.to !== id),
  }
}

export function moveNode(design: Design, id: string, position: Point): Design {
  return mapNode(design, id, (node) => ({ ...node, position }))
}

export function renameNode(design: Design, id: string, label: string): Design {
  return mapNode(design, id, (node) => ({ ...node, label }))
}

export function setParam(design: Design, id: string, key: string, value: number): Design {
  return mapNode(design, id, (node) => {
    const spec = catalog[node.kind].params.find((p) => p.key === key)
    if (!spec) throw new Error(`${node.kind} has no parameter "${key}"`)
    return { ...node, params: { ...node.params, [key]: clampParam(spec, value) } }
  })
}

/** Why `from → to` is not allowed, or null when it is. */
export function connectionError(design: Design, from: string, to: string): string | null {
  const source = getNode(design, from)
  const target = getNode(design, to)
  if (!source || !target) return 'Both ends must be components on the canvas'
  if (from === to) return 'A component cannot call itself'
  if (!catalog[target.kind].acceptsIncoming) return `Nothing calls a ${catalog[target.kind].label.toLowerCase()}`
  if (design.edges.some((edge) => edge.from === from && edge.to === to)) return 'Those two are already connected'
  return null
}

export function connect(
  design: Design,
  from: string,
  to: string,
  options: { id?: string; label?: string } = {},
): { design: Design; edge: DesignEdge } {
  const error = connectionError(design, from, to)
  if (error) throw new Error(error)
  const edge: DesignEdge = { id: options.id ?? nextId(design, 'edge'), from, to }
  if (options.label) edge.label = options.label
  return { design: { ...design, edges: [...design.edges, edge] }, edge }
}

/** Set or (with an empty string) clear the note on a connection. */
export function setEdgeLabel(design: Design, edgeId: string, label: string): Design {
  if (!design.edges.some((edge) => edge.id === edgeId)) throw new Error(`No edge "${edgeId}"`)
  return {
    ...design,
    edges: design.edges.map((edge) => {
      if (edge.id !== edgeId) return edge
      const { label: _old, ...rest } = edge
      return label.trim() ? { ...rest, label } : rest
    }),
  }
}

export function renameDesign(design: Design, name: string): Design {
  return { ...design, name }
}

export function setSlo(design: Design, slo: Slo): Design {
  return { ...design, slo: normalizeSlo(slo) }
}

/** Set or (with an empty string) clear the design's notes. */
export function setNotes(design: Design, notes: string): Design {
  const { notes: _old, ...rest } = design
  return notes.trim() ? { ...rest, notes } : rest
}

export function disconnect(design: Design, edgeId: string): Design {
  return { ...design, edges: design.edges.filter((edge) => edge.id !== edgeId) }
}

export function outgoing(design: Design, id: string): DesignEdge[] {
  return design.edges.filter((edge) => edge.from === id)
}

export function incoming(design: Design, id: string): DesignEdge[] {
  return design.edges.filter((edge) => edge.to === id)
}

/** Axis-aligned box around every node position (not including node size). */
export function bounds(design: Design): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (design.nodes.length === 0) return null
  const xs = design.nodes.map((n) => n.position.x)
  const ys = design.nodes.map((n) => n.position.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

// ---- Serialization ----------------------------------------------------------

export function serializeDesign(design: Design): string {
  return JSON.stringify(design, null, 2)
}

/**
 * Accepts anything (an imported file, localStorage) and returns a valid Design or throws
 * a readable error. Unknown parameters are dropped, missing ones get defaults, and
 * out-of-range values are clamped, so old saves keep loading as the catalog evolves.
 */
export function parseDesign(input: unknown): Design {
  const raw = typeof input === 'string' ? JSON.parse(input) : input
  if (!isObject(raw)) throw new Error('A design must be a JSON object')
  if (raw.version !== 1) throw new Error(`Unsupported design version: ${String(raw.version)}`)
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new Error('A design needs "nodes" and "edges" arrays')

  let design = createDesign(typeof raw.name === 'string' && raw.name.trim() ? raw.name : undefined)
  if (typeof raw.notes === 'string' && raw.notes.trim()) design.notes = raw.notes
  if (raw.slo !== undefined) design.slo = normalizeSlo(raw.slo)

  raw.nodes.forEach((node, i) => {
    if (!isObject(node)) throw new Error(`Node #${i + 1} is not an object`)
    if (typeof node.id !== 'string' || !node.id) throw new Error(`Node #${i + 1} has no id`)
    if (!isComponentKind(node.kind)) throw new Error(`Node "${node.id}" has unknown kind "${String(node.kind)}"`)
    const position = isObject(node.position) ? node.position : {}
    design = addNode(
      design,
      node.kind,
      { x: finiteOr(position.x, 0), y: finiteOr(position.y, 0) },
      {
        id: node.id,
        label: typeof node.label === 'string' ? node.label : undefined,
        params: isObject(node.params) ? (node.params as Record<string, number>) : {},
      },
    ).design
  })

  raw.edges.forEach((edge, i) => {
    if (!isObject(edge)) throw new Error(`Edge #${i + 1} is not an object`)
    if (typeof edge.from !== 'string' || typeof edge.to !== 'string') throw new Error(`Edge #${i + 1} needs "from" and "to"`)
    const error = connectionError(design, edge.from, edge.to)
    if (error) throw new Error(`Edge ${edge.from} → ${edge.to}: ${error}`)
    design = connect(design, edge.from, edge.to, {
      id: typeof edge.id === 'string' && edge.id ? edge.id : undefined,
      label: typeof edge.label === 'string' ? edge.label : undefined,
    }).design
  })

  return design
}

// ---- Helpers ----------------------------------------------------------------

function mapNode(design: Design, id: string, fn: (node: DesignNode) => DesignNode): Design {
  if (!getNode(design, id)) throw new Error(`No node "${id}"`)
  return { ...design, nodes: design.nodes.map((node) => (node.id === id ? fn(node) : node)) }
}

function sanitizeParams(kind: ComponentKind, params: Record<string, unknown>): Record<string, number> {
  const result = defaultParams(kind)
  for (const spec of catalog[kind].params) {
    const value = params[spec.key]
    if (typeof value === 'number') result[spec.key] = clampParam(spec, value)
  }
  return result
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
