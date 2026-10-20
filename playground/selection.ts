import { getNode, type Design } from 'system-canvas'

export type Selection = { type: 'node'; id: string } | { type: 'edge'; id: string } | null

/** Drop a selection whose target no longer exists (after undo or delete). */
export function liveSelection(design: Design, selection: Selection): Selection {
  if (!selection) return null
  if (selection.type === 'node') return getNode(design, selection.id) ? selection : null
  return design.edges.some((e) => e.id === selection.id) ? selection : null
}

/** MIME type used when dragging a component from the palette onto the canvas. */
export const KIND_MIME = 'application/x-system-canvas-kind'
