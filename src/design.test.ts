import { describe, expect, it } from 'vitest'
import {
  addNode,
  connect,
  connectionError,
  createDesign,
  disconnect,
  incoming,
  moveNode,
  nextId,
  outgoing,
  parseDesign,
  removeNode,
  renameNode,
  serializeDesign,
  renameDesign,
  setEdgeLabel,
  setNotes,
  setParam,
  uniqueLabel,
  type Design,
} from 'system-canvas'

/** client → lb → api → db */
function threeTier(): Design {
  let d = createDesign('Three tier')
  d = addNode(d, 'client', { x: 0, y: 0 }).design
  d = addNode(d, 'load-balancer', { x: 200, y: 0 }).design
  d = addNode(d, 'service', { x: 400, y: 0 }, { label: 'API' }).design
  d = addNode(d, 'sql-db', { x: 600, y: 0 }).design
  d = connect(d, 'node-1', 'node-2').design
  d = connect(d, 'node-2', 'node-3').design
  d = connect(d, 'node-3', 'node-4', { label: 'reads' }).design
  return d
}

describe('nodes', () => {
  it('assigns sequential ids, the catalog label and default params', () => {
    const { design, node } = addNode(createDesign(), 'cache', { x: 10, y: 20 })
    expect(node).toEqual({
      id: 'node-1',
      kind: 'cache',
      label: 'Cache',
      position: { x: 10, y: 20 },
      params: { latency: 1, hitRate: 80, capacity: 50_000, replicas: 1, availability: 99.9 },
    })
    expect(nextId(design, 'node')).toBe('node-2')
  })

  it('never reuses an id after a gap', () => {
    let d = threeTier()
    d = removeNode(d, 'node-2')
    expect(nextId(d, 'node')).toBe('node-5')
  })

  it('numbers default labels so they stay distinguishable', () => {
    let d = createDesign()
    for (let i = 0; i < 3; i++) d = addNode(d, 'service', { x: 0, y: 0 }).design
    expect(d.nodes.map((n) => n.label)).toEqual(['Service', 'Service 2', 'Service 3'])
    expect(uniqueLabel(d, 'Cache')).toBe('Cache')
  })

  it('rejects duplicate ids', () => {
    const d = addNode(createDesign(), 'service', { x: 0, y: 0 }, { id: 'api' }).design
    expect(() => addNode(d, 'service', { x: 0, y: 0 }, { id: 'api' })).toThrow(/Duplicate/)
  })

  it('removing a node also removes its edges', () => {
    const d = removeNode(threeTier(), 'node-3')
    expect(d.nodes.map((n) => n.id)).toEqual(['node-1', 'node-2', 'node-4'])
    expect(d.edges.map((e) => [e.from, e.to])).toEqual([['node-1', 'node-2']])
  })

  it('moves and renames without touching the original', () => {
    const before = threeTier()
    const after = renameNode(moveNode(before, 'node-3', { x: 1, y: 2 }), 'node-3', 'Orders')
    expect(after.nodes[2]).toMatchObject({ label: 'Orders', position: { x: 1, y: 2 } })
    expect(before.nodes[2]).toMatchObject({ label: 'API', position: { x: 400, y: 0 } })
  })

  it('clamps parameters and refuses unknown ones', () => {
    const d = setParam(threeTier(), 'node-3', 'replicas', 999)
    expect(d.nodes[2].params.replicas).toBe(50)
    expect(() => setParam(d, 'node-3', 'hitRate', 50)).toThrow(/no parameter/)
    expect(() => setParam(d, 'nope', 'replicas', 2)).toThrow(/No node/)
  })
})

describe('edges', () => {
  it('connects and lists neighbours', () => {
    const d = threeTier()
    expect(outgoing(d, 'node-2').map((e) => e.to)).toEqual(['node-3'])
    expect(incoming(d, 'node-2').map((e) => e.from)).toEqual(['node-1'])
    expect(d.edges[2]).toEqual({ id: 'edge-3', from: 'node-3', to: 'node-4', label: 'reads' })
  })

  it('explains invalid connections', () => {
    const d = threeTier()
    expect(connectionError(d, 'node-3', 'node-3')).toMatch(/itself/)
    expect(connectionError(d, 'node-2', 'node-1')).toMatch(/Nothing calls a client/)
    expect(connectionError(d, 'node-1', 'node-2')).toMatch(/already connected/)
    expect(connectionError(d, 'node-1', 'ghost')).toMatch(/Both ends/)
    expect(connectionError(d, 'node-4', 'node-3')).toBeNull() // reverse direction is a different call
    expect(() => connect(d, 'node-3', 'node-3')).toThrow(/itself/)
  })

  it('sets and clears connection labels', () => {
    let d = setEdgeLabel(threeTier(), 'edge-1', 'https')
    expect(d.edges[0]).toEqual({ id: 'edge-1', from: 'node-1', to: 'node-2', label: 'https' })
    d = setEdgeLabel(d, 'edge-1', '  ')
    expect(d.edges[0]).toEqual({ id: 'edge-1', from: 'node-1', to: 'node-2' })
    expect(() => setEdgeLabel(d, 'edge-99', 'x')).toThrow(/No edge/)
  })

  it('renames the design', () => {
    expect(renameDesign(threeTier(), 'Shop').name).toBe('Shop')
  })

  it('sets and clears notes, and keeps them through JSON', () => {
    const d = setNotes(threeTier(), 'Reads dominate, so cache aggressively.')
    expect(parseDesign(serializeDesign(d)).notes).toBe('Reads dominate, so cache aggressively.')
    expect('notes' in setNotes(d, ' ')).toBe(false)
    expect('notes' in parseDesign({ version: 1, nodes: [], edges: [], notes: 42 })).toBe(false)
  })

  it('disconnects by edge id', () => {
    const d = disconnect(threeTier(), 'edge-2')
    expect(d.edges.map((e) => e.id)).toEqual(['edge-1', 'edge-3'])
  })
})

describe('serialization', () => {
  it('round-trips through JSON', () => {
    const d = setParam(threeTier(), 'node-3', 'latency', 42)
    expect(parseDesign(serializeDesign(d))).toEqual(d)
  })

  it('fills missing params, drops unknown ones and clamps bad values', () => {
    const d = parseDesign({
      version: 1,
      name: 'Old save',
      nodes: [{ id: 'a', kind: 'service', position: { x: 5 }, params: { replicas: -3, legacy: 7 } }],
      edges: [],
    })
    expect(d.nodes[0]).toEqual({
      id: 'a',
      kind: 'service',
      label: 'Service',
      position: { x: 5, y: 0 },
      params: { latency: 30, capacity: 500, replicas: 1, availability: 99.5 },
    })
  })

  it('throws readable errors for broken input', () => {
    expect(() => parseDesign('[]')).toThrow(/JSON object/)
    expect(() => parseDesign({ version: 2, nodes: [], edges: [] })).toThrow(/version/)
    expect(() => parseDesign({ version: 1, nodes: [{ id: 'x', kind: 'mainframe' }], edges: [] })).toThrow(/unknown kind "mainframe"/)
    expect(() =>
      parseDesign({ version: 1, nodes: [{ id: 'x', kind: 'service' }], edges: [{ from: 'x', to: 'y' }] }),
    ).toThrow(/x → y/)
  })
})
