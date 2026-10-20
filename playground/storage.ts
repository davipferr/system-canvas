import { parseDesign, serializeDesign, type AlertRule, type Design } from 'system-canvas'

const KEY = 'system-canvas:design'

/**
 * The design saved in this browser, or null. Storage can be missing or blocked (private
 * windows, cleared site data) and old saves can be broken, so every failure means "nothing saved".
 */
export function loadSaved(): Design | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? parseDesign(raw) : null
  } catch {
    return null
  }
}

/** Returns false when the browser refused to store it. */
export function save(design: Design): boolean {
  try {
    localStorage.setItem(KEY, serializeDesign(design))
    return true
  } catch {
    return false
  }
}

/** "My Shop: v2" → "my-shop-v2.json" */
export function fileName(design: Design, extension = 'json'): string {
  const slug = design.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'system'}.${extension}`
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadDesign(design: Design) {
  downloadBlob(new Blob([serializeDesign(design)], { type: 'application/json' }), fileName(design))
}

/** Reads a user-picked file; throws with a readable message when it is not a design. */
export async function readDesignFile(file: File): Promise<Design> {
  const text = await file.text()
  try {
    return parseDesign(text)
  } catch (error) {
    const reason = error instanceof SyntaxError ? 'it is not valid JSON' : (error as Error).message
    throw new Error(`Could not open ${file.name}: ${reason}`)
  }
}

// ---- Challenges ------------------------------------------------------------------

const CHALLENGE_KEY = 'system-canvas:challenge'
const COMPLETED_KEY = 'system-canvas:completed'

/** Id of the challenge in progress, so a reload keeps the goals on screen. */
export function loadChallengeId(): string | null {
  try {
    return localStorage.getItem(CHALLENGE_KEY)
  } catch {
    return null
  }
}

export function saveChallengeId(id: string | null) {
  try {
    if (id) localStorage.setItem(CHALLENGE_KEY, id)
    else localStorage.removeItem(CHALLENGE_KEY)
  } catch {
    // Storage blocked: the challenge simply will not survive a reload.
  }
}

export function loadCompleted(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(COMPLETED_KEY) ?? '[]')
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

export function saveCompleted(ids: ReadonlySet<string>) {
  try {
    localStorage.setItem(COMPLETED_KEY, JSON.stringify([...ids]))
  } catch {
    // Storage blocked: completion badges last until the tab closes.
  }
}

// ---- Alert rules -------------------------------------------------------------------

const ALERT_RULES_KEY = 'system-canvas:alert-rules'

/**
 * The viewer's tuned alert rules, laid over the defaults by id: new default rules still appear,
 * and only known fields with the right types are taken from storage.
 */
export function loadAlertRules(defaults: AlertRule[]): AlertRule[] {
  try {
    const saved = JSON.parse(localStorage.getItem(ALERT_RULES_KEY) ?? '[]')
    if (!Array.isArray(saved)) return defaults
    return defaults.map((rule) => {
      const s = saved.find((x) => x && x.id === rule.id)
      if (!s) return rule
      return {
        ...rule,
        enabled: typeof s.enabled === 'boolean' ? s.enabled : rule.enabled,
        threshold: typeof s.threshold === 'number' && s.threshold >= 0 ? s.threshold : rule.threshold,
        forMinutes: typeof s.forMinutes === 'number' && s.forMinutes >= 0 ? s.forMinutes : rule.forMinutes,
      }
    })
  } catch {
    return defaults
  }
}

export function saveAlertRules(rules: AlertRule[]) {
  try {
    const tuned = rules.map(({ id, enabled, threshold, forMinutes }) => ({ id, enabled, threshold, forMinutes }))
    localStorage.setItem(ALERT_RULES_KEY, JSON.stringify(tuned))
  } catch {
    // Storage blocked: the rules last until the tab closes.
  }
}
