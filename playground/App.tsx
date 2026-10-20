import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addNode,
  analyzeAvailability,
  applyTraffic,
  breakingPoint,
  commitFrom,
  createDesign,
  createHistory,
  DEFAULT_ALERT_RULES,
  DEFAULT_SLO,
  disconnect,
  evaluateAlerts,
  evaluateGoals,
  evaluateSlo,
  failureImpact,
  getNode,
  isSingleInstance,
  metricPoint,
  preview,
  push,
  redo,
  removeNode,
  renameDesign,
  sampleRequests,
  scaleTraffic,
  setParam,
  settle,
  simulate,
  SPOF_THRESHOLD,
  TRAFFIC_PATTERNS,
  undo,
  type ComponentKind,
  type Design,
  type MetricPoint,
} from 'system-canvas'
import type { FailureState } from './AvailabilityStats'
import { ChallengePanel } from './ChallengePanel'
import { challenges, type Challenge } from './challenges'
import { Dashboard, type TimelineEvent } from './Dashboard'
import { Estimator } from './Estimator'
import { Library } from './Library'
import type { Template } from './templates'
import { Canvas, GRID, NODE_H, NODE_W, snap, type CanvasHandle, type Editor } from './Canvas'
import { Inspector } from './Inspector'
import { MetricsPanel } from './MetricsPanel'
import { Palette } from './Palette'
import { sampleDesign } from './sample'
import { liveSelection, type Selection } from './selection'
import { useClock } from './useClock'
import { canvasToSvg, svgToPng } from './exportImage'
import {
  downloadBlob,
  downloadDesign,
  fileName,
  loadAlertRules,
  loadChallengeId,
  loadCompleted,
  loadSaved,
  readDesignFile,
  save,
  saveAlertRules,
  saveChallengeId,
  saveCompleted,
} from './storage'

/** Points kept per chart: an hour at 1 min/s, two and a half days at 1 h/s. */
const MAX_POINTS = 240

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

export function App() {
  // First visit shows the sample; after that, whatever was last on the canvas.
  const [history, setHistory] = useState(() => createHistory(loadSaved() ?? sampleDesign()))
  const [rawSelection, setSelection] = useState<Selection>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [storageOk, setStorageOk] = useState(true)
  const canvas = useRef<CanvasHandle>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const design = history.present
  const selection = liveSelection(design, rawSelection)
  // Simulate mode: heat and flowing requests on the canvas, plus a load multiplier to stress-test.
  const [simulating, setSimulating] = useState(false)
  const [loadFactor, setLoadFactor] = useState(1)
  // While simulating, a clock runs and its traffic pattern scales the load over time.
  const clock = useClock(simulating)
  const factor = simulating ? loadFactor * clock.multiplier : 1
  const [metrics, setMetrics] = useState<MetricPoint[]>([])
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const mark = (label: string, kind: TimelineEvent['kind']) => {
    if (simulating) setEvents((list) => [...list, { t: clock.t, label, kind }].slice(-50))
  }

  // Failure injection: components switched off by the user. Not part of the design (or undo),
  // just a what-if; ids of deleted components drop out on their own.
  const [failedIds, setFailedIds] = useState<string[]>([])
  const failed = useMemo(
    () => new Set(failedIds.filter((id) => getNode(design, id))),
    [failedIds, design],
  )
  const toggleFailed = (id: string) => {
    const name = getNode(design, id)?.label ?? id
    mark(failedIds.includes(id) ? `${name} restored` : `${name} down`, failedIds.includes(id) ? 'recover' : 'fail')
    setFailedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }

  // Challenges: the active one fixes the traffic every number below is computed with.
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [estimatorOpen, setEstimatorOpen] = useState(false)
  const [challengeId, setChallengeId] = useState<string | null>(() => loadChallengeId())
  const [completed, setCompleted] = useState<Set<string>>(() => loadCompleted())
  const challenge = challenges.find((c) => c.id === challengeId) ?? null
  const effective = useMemo(
    () => (challenge ? applyTraffic(design, challenge.goals.rps, challenge.goals.readRatio) : design),
    [design, challenge],
  )
  const evaluation = useMemo(
    () => (challenge ? evaluateGoals(design, challenge.goals) : null),
    [design, challenge],
  )

  const sim = useMemo(
    () => simulate(factor === 1 ? effective : scaleTraffic(effective, factor), { failed }),
    [effective, factor, failed],
  )
  const breaking = useMemo(() => breakingPoint(effective), [effective])
  const availability = useMemo(() => analyzeAvailability(effective, { failed }), [effective, failed])

  // SRE view: follow sample requests through the live simulation for percentiles and error rate,
  // and compare them (and the hardware-only availability) with the design's SLOs.
  const slo = design.slo ?? DEFAULT_SLO
  const sample = useMemo(() => sampleRequests(effective, sim), [effective, sim])
  const baseline = useMemo(() => analyzeAvailability(effective).system, [effective])
  const sloReport = useMemo(() => evaluateSlo(slo, baseline, sample), [slo, baseline, sample])
  const impact = useMemo(() => failureImpact(effective, failed), [effective, failed])
  const spofs = design.nodes
    .filter((n) => isSingleInstance(n) && (impact[n.id] ?? 0) >= SPOF_THRESHOLD)
    .sort((a, b) => impact[b.id] - impact[a.id])
    .map((n) => n.id)
  const failures: FailureState = {
    failed,
    impact,
    spofs,
    toggle: toggleFailed,
    restoreAll: () => {
      mark('All restored', 'recover')
      setFailedIds([])
    },
  }

  // Record what a monitoring system would scrape, once per clock tick.
  useEffect(() => {
    if (!simulating) return
    const point = metricPoint(clock.t, factor, sim, sample, sloReport.errorBudget, slo.latencyPercentile)
    setMetrics((list) => [...list.filter((p) => p.t < clock.t), point].slice(-MAX_POINTS))
  }, [clock.t, simulating])

  // Alerting: rules replayed over the recorded metrics. Pages interrupt with a toast; tickets don't.
  const [rules, setRules] = useState(() => loadAlertRules(DEFAULT_ALERT_RULES))
  useEffect(() => saveAlertRules(rules), [rules])
  const alerts = useMemo(() => evaluateAlerts(rules, metrics, slo.latencyMs), [rules, metrics, slo.latencyMs])
  const paged = useRef(new Set<string>())
  useEffect(() => {
    for (const incident of alerts.incidents) {
      const key = `${incident.ruleId}:${incident.target}:${incident.firedAt}`
      const rule = rules.find((r) => r.id === incident.ruleId)
      if (paged.current.has(key) || rule?.severity !== 'page') continue
      paged.current.add(key)
      setNotice(`🔔 Paged: ${rule.name}`)
    }
  }, [alerts.incidents])

  const resetTimeline = () => {
    clock.reset()
    setMetrics([])
    setEvents([])
    paged.current.clear()
  }

  const editor = useMemo<Editor>(
    () => ({
      push: (next, mergeKey) => setHistory((h) => push(h, next, mergeKey)),
      preview: (next) => setHistory((h) => preview(h, next)),
      commitFrom: (before) => setHistory((h) => commitFrom(h, before)),
      settle: () => setHistory(settle),
    }),
    [],
  )

  // Edits to one component should not merge with edits to the next one.
  const selectionKey = selection ? `${selection.type}:${selection.id}` : ''
  useEffect(() => setHistory(settle), [selectionKey])

  // Autosave shortly after the last change, so a slider drag is one write, not hundreds.
  useEffect(() => {
    const timer = setTimeout(() => setStorageOk(save(design)), 300)
    return () => clearTimeout(timer)
  }, [design])

  useEffect(() => saveChallengeId(challengeId), [challengeId])

  // Celebrate (once) the first time every goal of a challenge passes.
  useEffect(() => {
    if (!challenge || !evaluation?.passed || completed.has(challenge.id)) return
    const next = new Set(completed).add(challenge.id)
    setCompleted(next)
    saveCompleted(next)
    setNotice(`Challenge complete: ${challenge.name}!`)
  }, [challenge, evaluation?.passed, completed])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 3000)
    return () => clearTimeout(timer)
  }, [notice])

  /** Palette click: drop the component in the middle of the view, nudged off anything already there. */
  const addAtCenter = (kind: ComponentKind) => {
    const center = canvas.current?.viewCenter() ?? { x: 0, y: 0 }
    let position = snap({ x: center.x - NODE_W / 2, y: center.y - NODE_H / 2 })
    const taken = (p: typeof position) => design.nodes.some((n) => n.position.x === p.x && n.position.y === p.y)
    while (taken(position)) position = { x: position.x + GRID, y: position.y + GRID * 2 }
    const result = addNode(design, kind, position)
    editor.push(result.design)
    setSelection({ type: 'node', id: result.node.id })
  }

  const deleteSelection = () => {
    if (!selection) return
    editor.push(selection.type === 'node' ? removeNode(design, selection.id) : disconnect(design, selection.id))
    setSelection(null)
  }

  const deleteRef = useRef(deleteSelection)
  deleteRef.current = deleteSelection
  const failSelectedRef = useRef(() => {})
  failSelectedRef.current = () => {
    if (selection?.type === 'node' && getNode(design, selection.id)?.kind !== 'client') toggleFailed(selection.id)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z') {
        e.preventDefault()
        setHistory((h) => (e.shiftKey ? redo(h) : undo(h)))
      } else if (mod && key === 'y') {
        e.preventDefault()
        setHistory(redo)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteRef.current()
      } else if (e.key === 'Escape') {
        setSelection(null)
      } else if (!mod && key === 'f') {
        canvas.current?.fit()
      } else if (!mod && key === 's') {
        setSimulating((on) => !on)
      } else if (!mod && key === 'x') {
        failSelectedRef.current()
      } else if (!mod && key === 'e') {
        setEstimatorOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const replaceAll = (next: Design) => {
    editor.push(next)
    setSelection(null)
    // Wait for the new nodes to render before framing them.
    requestAnimationFrame(() => canvas.current?.fit())
  }

  const openTemplate = (template: Template) => {
    replaceAll(template.build())
    setChallengeId(null)
    setLibraryOpen(false)
  }

  const startChallenge = (c: Challenge) => {
    replaceAll(c.start())
    setChallengeId(c.id)
    setFailedIds([])
    setLibraryOpen(false)
  }

  /** Estimator → canvas: share the peak traffic between the clients (adding one if there is none). */
  const applyEstimate = (peakRps: number, readPercent: number) => {
    if (challenge) {
      setNotice('Leave the challenge first: it fixes the traffic.')
      return
    }
    let next = design
    if (!next.nodes.some((n) => n.kind === 'client')) {
      const center = canvas.current?.viewCenter() ?? { x: 0, y: 0 }
      next = addNode(next, 'client', snap({ x: center.x - NODE_W / 2, y: center.y - NODE_H / 2 }), { label: 'Users' })
        .design
    }
    const clients = next.nodes.filter((n) => n.kind === 'client')
    for (const client of clients) {
      next = setParam(next, client.id, 'rps', Math.round(peakRps / clients.length))
      next = setParam(next, client.id, 'readRatio', readPercent)
    }
    editor.push(next)
    setEstimatorOpen(false)
    const capped = peakRps / clients.length > 1_000_000
    setNotice(
      capped
        ? 'Peak traffic is above 1M rps per client, so each client is capped at 1M. Add more clients to share it.'
        : `${clients.length === 1 ? 'The client now sends' : 'Clients now send'} ${Math.round(peakRps).toLocaleString('en-US')} rps in total.`,
    )
  }

  /** Download the canvas as a picture. Selection highlights are cleared first so they stay out of it. */
  const exportImage = (format: 'svg' | 'png') => {
    setSelection(null)
    requestAnimationFrame(async () => {
      const svg = canvas.current?.svg()
      if (!svg || design.nodes.length === 0) {
        setNotice('Add some components first: there is nothing to export.')
        return
      }
      const { markup, width, height } = canvasToSvg(svg)
      try {
        const blob =
          format === 'svg' ? new Blob([markup], { type: 'image/svg+xml' }) : await svgToPng(markup, width, height)
        downloadBlob(blob, fileName(design, format))
      } catch (error) {
        setNotice((error as Error).message)
      }
    })
  }

  const importFile = async (file: File | undefined) => {
    if (!file) return
    try {
      replaceAll(await readDesignFile(file))
      setChallengeId(null)
      setNotice(`Opened ${file.name}`)
    } catch (error) {
      setNotice((error as Error).message)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1>System Canvas</h1>
        <input
          className="design-name"
          type="text"
          aria-label="Design name"
          value={design.name}
          onChange={(e) => editor.push(renameDesign(design, e.target.value), 'design-name')}
          onBlur={() => {
            if (!design.name.trim()) editor.push(renameDesign(design, 'Untitled system'))
            editor.settle()
          }}
        />
        {failed.size > 0 && (
          <button className="down-chip" onClick={failures.restoreAll} title="Bring every component back up">
            {failed.size} down · Restore
          </button>
        )}
        {!storageOk && (
          <span className="save-warning" title="This browser is blocking site storage. Use Export to keep your work.">
            Not saved
          </span>
        )}
        <div className="topbar-actions">
          <button onClick={() => setHistory(undo)} disabled={history.past.length === 0} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button onClick={() => setHistory(redo)} disabled={history.future.length === 0} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
          <button
            className={simulating ? 'primary' : undefined}
            onClick={() => setSimulating((on) => !on)}
            title="Show traffic flowing through the design (S)"
            aria-pressed={simulating}
          >
            {simulating ? '■ Stop' : '▶ Simulate'}
          </button>
          <span className="divider" />
          <button
            onClick={() => {
              replaceAll(createDesign())
              setChallengeId(null)
            }}
            title="Start an empty design (undoable)"
          >
            New
          </button>
          <button onClick={() => setLibraryOpen(true)} title="Templates and challenges">
            Library
          </button>
          <button onClick={() => setEstimatorOpen(true)} title="Back-of-the-envelope estimate (E)">
            Estimate
          </button>
          <button onClick={() => fileInput.current?.click()} title="Open a design from a .json file">
            Import
          </button>
          <details className="menu">
            <summary>Export</summary>
            <div
              className="menu-list"
              // Picking an item closes the menu.
              onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).removeAttribute('open')}
            >
              <button onClick={() => downloadDesign(design)}>
                Design (.json)<span className="muted">re-open it later with Import</span>
              </button>
              <button onClick={() => exportImage('svg')}>
                Image (.svg)<span className="muted">sharp at any size, editable</span>
              </button>
              <button onClick={() => exportImage('png')}>
                Image (.png)<span className="muted">for docs and slides</span>
              </button>
            </div>
          </details>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              void importFile(e.target.files?.[0])
              e.target.value = '' // allow picking the same file again
            }}
          />
        </div>
      </header>
      <div className="workspace">
        <Palette onAdd={addAtCenter} />
        <div className="center">
          <Canvas
            ref={canvas}
            design={design}
            selection={selection}
            onSelect={setSelection}
            editor={editor}
            notice={notice}
            notify={setNotice}
            sim={simulating ? sim : null}
            failed={failed}
            spofs={simulating ? spofs : []}
            overlay={
              <>
                {challenge && evaluation && (
                  <ChallengePanel
                    key={challenge.id}
                    challenge={challenge}
                    results={evaluation.results}
                    passed={evaluation.passed}
                    onShowSolution={() => replaceAll(challenge.solution())}
                    onLeave={() => setChallengeId(null)}
                  />
                )}
                {simulating && (
                  <MetricsPanel
                    design={design}
                    sim={sim}
                    factor={loadFactor}
                    onFactor={setLoadFactor}
                    breaking={breaking}
                    availability={availability.system}
                    spofCount={spofs.length}
                    sloReport={sloReport}
                    trafficFactor={factor}
                  />
                )}
              </>
            }
          />
          {simulating && (
            <Dashboard
              design={design}
              metrics={metrics}
              events={events}
              clock={clock}
              onPattern={(pattern) => {
                clock.setPattern(pattern)
                mark(TRAFFIC_PATTERNS.find((p) => p.id === pattern)!.label, 'change')
              }}
              onReset={resetTimeline}
              selectedId={selection?.type === 'node' ? selection.id : null}
              slo={slo}
              errorBudget={sloReport.errorBudget}
              rules={rules}
              onRules={setRules}
              onResetRules={() => setRules(DEFAULT_ALERT_RULES)}
              alertStates={alerts.states}
              incidents={alerts.incidents}
            />
          )}
        </div>
        <Inspector
          design={design}
          selection={selection}
          onDelete={deleteSelection}
          editor={editor}
          sim={sim}
          availability={availability}
          failures={failures}
          slo={slo}
          sloReport={sloReport}
          sample={sample}
          trafficNote={
            challenge
              ? `The challenge fixes traffic at ${challenge.goals.rps.toLocaleString('en-US')} rps (${challenge.goals.readRatio}% reads), so this client's own settings are ignored until you leave it.`
              : undefined
          }
        />
      </div>
      <Estimator open={estimatorOpen} onClose={() => setEstimatorOpen(false)} onApply={applyEstimate} />
      <Library
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onOpenTemplate={openTemplate}
        onStartChallenge={startChallenge}
        completed={completed}
      />
    </div>
  )
}
