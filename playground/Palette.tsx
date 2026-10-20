import { categories, specsInCategory, type ComponentKind } from 'system-canvas'
import { KindIcon } from './icons'
import { KIND_MIME } from './selection'

export function Palette({ onAdd }: { onAdd: (kind: ComponentKind) => void }) {
  return (
    <aside className="panel palette" aria-label="Components">
      <h2>Components</h2>
      {categories.map((category) => (
        <section key={category.id} className="palette-group">
          <h3>{category.label}</h3>
          <ul>
            {specsInCategory(category.id).map((spec) => (
              <li key={spec.kind}>
                <button
                  className="palette-item"
                  data-category={spec.category}
                  title={spec.concept}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(KIND_MIME, spec.kind)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => onAdd(spec.kind)}
                >
                  <span className="palette-icon">
                    <KindIcon kind={spec.kind} size={18} />
                  </span>
                  {spec.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  )
}
