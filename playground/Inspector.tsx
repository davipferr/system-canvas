import {
  catalog,
  componentCost,
  getNode,
  incoming,
  outgoing,
  renameNode,
  setEdgeLabel,
  setNotes,
  setParam,
  uniqueLabel,
  type AvailabilityResult,
  type Design,
  type SimulationResult,
} from 'system-canvas'
import { NodeAvailability, SystemAvailability, type FailureState } from './AvailabilityStats'
import type { Editor } from './Canvas'
import { ParamField } from './fields'
import { KindIcon } from './icons'
import { EdgeLoad, NodeLoad, SystemSummary } from './LoadStats'
import type { Selection } from './selection'

const edgeLabelPresets = ['reads', 'writes', 'async', 'events', 'https', 'gRPC']

const shortcuts: [string, string][] = [
  ['Drag a palette item', 'add a component'],
  ['Drag the right-hand dot', 'connect two components'],
  ['Drag the background', 'pan'],
  ['Mouse wheel', 'zoom'],
  ['F', 'fit the design in view'],
  ['S', 'simulate traffic'],
  ['E', 'back-of-the-envelope estimate'],
  ['X', 'fail / restore the selected component'],
  ['Delete', 'remove the selection'],
  ['Ctrl+Z / Ctrl+Shift+Z', 'undo / redo'],
]

export function Inspector({
  design,
  selection,
  onDelete,
  editor,
  sim,
  availability,
  failures,
  trafficNote,
}: {
  design: Design
  selection: Selection
  onDelete: () => void
  editor: Editor
  sim: SimulationResult
  availability: AvailabilityResult
  failures: FailureState
  /** Set while a challenge fixes the traffic, so client settings do not apply. */
  trafficNote?: string
}) {
  const name = (id: string) => getNode(design, id)?.label ?? id

  if (selection?.type === 'edge') {
    const edge = design.edges.find((e) => e.id === selection.id)!
    const from = getNode(design, edge.from)!
    const to = getNode(design, edge.to)!
    return (
      <aside className="panel inspector" aria-label="Inspector">
        <div className="inspector-title">
          <h2>Connection</h2>
          <button className="danger" onClick={onDelete}>
            Delete
          </button>
        </div>
        <div className="edge-ends">
          <span data-category={catalog[from.kind].category} className="edge-end">
            <span className="palette-icon">
              <KindIcon kind={from.kind} size={18} />
            </span>
            {from.label}
          </span>
          <span className="muted">calls</span>
          <span data-category={catalog[to.kind].category} className="edge-end">
            <span className="palette-icon">
              <KindIcon kind={to.kind} size={18} />
            </span>
            {to.label}
          </span>
        </div>
        <div className="field">
          <label htmlFor="edge-label">Label</label>
          <input
            id="edge-label"
            type="text"
            value={edge.label ?? ''}
            placeholder="e.g. reads"
            onChange={(e) => editor.push(setEdgeLabel(design, edge.id, e.target.value), `edge-label:${edge.id}`)}
            onBlur={editor.settle}
          />
          <div className="chips">
            {edgeLabelPresets.map((preset) => (
              <button
                key={preset}
                className={edge.label === preset ? 'chip active' : 'chip'}
                onClick={() => editor.push(setEdgeLabel(design, edge.id, edge.label === preset ? '' : preset))}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
        <EdgeLoad edgeId={edge.id} sim={sim} />
        <p className="callout">
          Arrows point in the direction of the request: {from.label} sends work to {to.label}, and every request it
          receives may become load on {to.label}.
        </p>
      </aside>
    )
  }

  const node = selection?.type === 'node' ? getNode(design, selection.id) : undefined

  if (!node) {
    return (
      <aside className="panel inspector" aria-label="Inspector">
        <h2>{design.name}</h2>
        <dl className="stats">
          <div>
            <dt>Components</dt>
            <dd>{design.nodes.length}</dd>
          </div>
          <div>
            <dt>Connections</dt>
            <dd>{design.edges.length}</dd>
          </div>
        </dl>
        <SystemSummary design={design} sim={sim} />
        <SystemAvailability design={design} availability={availability} failures={failures} />
        <div className="field">
          <label htmlFor="design-notes">Notes</label>
          <textarea
            id="design-notes"
            rows={5}
            value={design.notes ?? ''}
            placeholder="Requirements, decisions, trade-offs..."
            onChange={(e) => editor.push(setNotes(design, e.target.value), 'notes')}
            onBlur={editor.settle}
          />
        </div>
        <p className="muted small">Select a component or connection to see what it does.</p>
        <section className="links">
          <h3>How to edit</h3>
          <dl className="shortcuts">
            {shortcuts.map(([keys, action]) => (
              <div key={keys}>
                <dt>{keys}</dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </section>
      </aside>
    )
  }

  const spec = catalog[node.kind]
  const calls = outgoing(design, node.id)
  const calledBy = incoming(design, node.id)

  return (
    <aside className="panel inspector" aria-label="Inspector">
      <div className="inspector-title">
        <div className="inspector-head" data-category={spec.category}>
          <span className="palette-icon">
            <KindIcon kind={node.kind} />
          </span>
          <div>
            <input
              className="title-input"
              type="text"
              aria-label="Component name"
              value={node.label}
              onChange={(e) => editor.push(renameNode(design, node.id, e.target.value), `label:${node.id}`)}
              onBlur={() => {
                if (!node.label.trim()) editor.push(renameNode(design, node.id, uniqueLabel(design, spec.label)))
                editor.settle()
              }}
            />
            <p className="muted small">{spec.label}</p>
          </div>
        </div>
        <button className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
      <p className="callout">{spec.concept}</p>

      {node.kind === 'client' && trafficNote && <p className="callout warn-box small">{trafficNote}</p>}
      <NodeLoad node={node} sim={sim} />
      <NodeAvailability node={node} availability={availability} failures={failures} sim={sim} />

      <div className="settings-head">
        <h3>Settings</h3>
        <span className="muted small">≈ ${componentCost(node).toLocaleString('en-US')}/month</span>
      </div>
      <div className="params">
        {spec.params.map((p) => (
          <ParamField
            key={`${node.id}:${p.key}`}
            spec={p}
            value={node.params[p.key]}
            onChange={(value) => editor.push(setParam(design, node.id, p.key, value), `param:${node.id}:${p.key}`)}
            onSettle={editor.settle}
          />
        ))}
      </div>

      <div className="links">
        <h3>Calls</h3>
        <ul>
          {calls.map((e) => (
            <li key={e.id}>
              → {name(e.to)} {e.label && <span className="muted">({e.label})</span>}
            </li>
          ))}
          {calls.length === 0 && <li className="muted">nothing</li>}
        </ul>
        <h3>Called by</h3>
        <ul>
          {calledBy.map((e) => (
            <li key={e.id}>
              ← {name(e.from)} {e.label && <span className="muted">({e.label})</span>}
            </li>
          ))}
          {calledBy.length === 0 && <li className="muted">nobody</li>}
        </ul>
      </div>
    </aside>
  )
}
