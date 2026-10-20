import { addNode, connect, createDesign, setNotes, type ComponentKind, type Design } from 'system-canvas'

/** Columns and rows of the layout grid used by templates and challenges. */
const COL = 260
const ROW = 110

export interface Blueprint {
  /** Add a component at grid cell (col, row) and return its id. */
  place(kind: ComponentKind, col: number, row: number, label?: string, params?: Record<string, number>): string
  link(from: string, to: string, label?: string): void
}

/** Build a design in code: `blueprint('Name', notes, (b) => { const a = b.place(...); b.link(a, ...) })`. */
export function blueprint(name: string, notes: string, build: (b: Blueprint) => void): Design {
  let design = setNotes(createDesign(name), notes)
  build({
    place(kind, col, row, label, params) {
      const result = addNode(design, kind, { x: col * COL, y: row * ROW }, { label, params })
      design = result.design
      return result.node.id
    },
    link(from, to, label) {
      design = connect(design, from, to, { label }).design
    },
  })
  return design
}
