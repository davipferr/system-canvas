import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * A native <dialog> shown with showModal(): focus trapping, Escape to close and the backdrop
 * come from the browser. Clicking the backdrop also closes it.
 */
export function Modal({
  open,
  onClose,
  title,
  headerExtra,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  /** Rendered next to the title (tabs, for instance). */
  headerExtra?: ReactNode
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const d = dialog.current!
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={dialog}
      className="modal"
      onClose={onClose}
      // The dialog element itself is only the target when the click lands on the backdrop.
      onClick={(e) => e.target === dialog.current && onClose()}
      aria-labelledby={titleId}
    >
      <div className="modal-inner">
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          {headerExtra}
          <button className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </dialog>
  )
}
