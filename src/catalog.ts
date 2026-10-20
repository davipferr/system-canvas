// The building blocks you can drop on the canvas. Each kind carries the numbers the
// simulator will need later (capacity, latency, replicas...) as tunable parameters,
// plus a one-line concept note so the palette doubles as a glossary.

export type Category = 'clients' | 'edge' | 'compute' | 'data' | 'messaging' | 'external'

export type ComponentKind =
  | 'client'
  | 'dns'
  | 'cdn'
  | 'load-balancer'
  | 'api-gateway'
  | 'service'
  | 'worker'
  | 'cache'
  | 'sql-db'
  | 'nosql-db'
  | 'object-storage'
  | 'search'
  | 'queue'
  | 'stream'
  | 'external-api'

export interface ParamSpec {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  unit?: string
}

export interface ComponentSpec {
  kind: ComponentKind
  label: string
  category: Category
  /** One sentence: what it is and why you'd reach for it. */
  concept: string
  params: ParamSpec[]
  /** False for things that only originate traffic (nothing calls a user). */
  acceptsIncoming: boolean
}

export const categories: { id: Category; label: string }[] = [
  { id: 'clients', label: 'Clients' },
  { id: 'edge', label: 'Edge & routing' },
  { id: 'compute', label: 'Compute' },
  { id: 'data', label: 'Data' },
  { id: 'messaging', label: 'Messaging' },
  { id: 'external', label: 'External' },
]

// Shared parameter shapes, so the same knob means the same thing everywhere.
const replicas = (value = 1): ParamSpec => ({
  key: 'replicas',
  label: 'Replicas',
  min: 1,
  max: 50,
  step: 1,
  default: value,
})
const capacity = (value: number, max = 100_000): ParamSpec => ({
  key: 'capacity',
  label: 'Capacity per replica',
  min: 10,
  max,
  step: 10,
  default: value,
  unit: 'rps',
})
const latency = (value: number, max = 2_000): ParamSpec => ({
  key: 'latency',
  label: 'Base latency',
  min: 0.1,
  max,
  step: 0.1,
  default: value,
  unit: 'ms',
})
/**
 * Chance that ONE instance is up, as a percentage. Replicas multiply downtime, so three
 * 99.5% instances give 1 − 0.005³ = 99.99999%. The slider moves in "nines".
 */
const availability = (value: number): ParamSpec => ({
  key: 'availability',
  label: 'Availability per instance',
  min: 90,
  max: 99.999,
  step: 0.001,
  default: value,
  unit: '%',
})
const percent = (key: string, label: string, value: number): ParamSpec => ({
  key,
  label,
  min: 0,
  max: 100,
  step: 1,
  default: value,
  unit: '%',
})

const specs: ComponentSpec[] = [
  {
    kind: 'client',
    label: 'Client',
    category: 'clients',
    concept: 'Users (browsers, apps) generating the traffic that every other box has to absorb.',
    acceptsIncoming: false,
    params: [
      { key: 'rps', label: 'Requests per second', min: 1, max: 1_000_000, step: 1, default: 1_000, unit: 'rps' },
      percent('readRatio', 'Reads', 90),
    ],
  },
  {
    kind: 'dns',
    label: 'DNS',
    category: 'edge',
    concept: 'Turns a hostname into an IP. Cached aggressively, so it is rarely the bottleneck.',
    acceptsIncoming: true,
    params: [latency(20), availability(99.99)],
  },
  {
    kind: 'cdn',
    label: 'CDN',
    category: 'edge',
    concept: 'Edge servers near users that serve static or cacheable content without touching your origin.',
    acceptsIncoming: true,
    params: [latency(15), percent('hitRate', 'Cache hit rate', 85), capacity(100_000, 1_000_000), availability(99.99)],
  },
  {
    kind: 'load-balancer',
    label: 'Load balancer',
    category: 'edge',
    concept: 'Spreads requests across identical servers so you can scale horizontally and survive one dying.',
    acceptsIncoming: true,
    params: [latency(1, 50), capacity(50_000, 1_000_000), replicas(2), availability(99.99)],
  },
  {
    kind: 'api-gateway',
    label: 'API gateway',
    category: 'edge',
    concept: 'Single front door that handles auth, rate limiting and routing to the right service.',
    acceptsIncoming: true,
    params: [latency(5, 100), capacity(20_000, 500_000), replicas(2), availability(99.95)],
  },
  {
    kind: 'service',
    label: 'Service',
    category: 'compute',
    concept: 'Stateless application servers running your business logic; add replicas to scale.',
    acceptsIncoming: true,
    params: [latency(30), capacity(500, 20_000), replicas(3), availability(99.5)],
  },
  {
    kind: 'worker',
    label: 'Worker',
    category: 'compute',
    concept: 'Background processes that pull jobs off a queue, so slow work never blocks a user request.',
    acceptsIncoming: true,
    params: [latency(200, 60_000), capacity(100, 10_000), replicas(2), availability(99.5)],
  },
  {
    kind: 'cache',
    label: 'Cache',
    category: 'data',
    concept: 'In-memory key-value store (Redis, Memcached) that answers hot reads in a millisecond.',
    acceptsIncoming: true,
    params: [latency(1, 50), percent('hitRate', 'Cache hit rate', 80), capacity(50_000, 500_000), replicas(1), availability(99.9)],
  },
  {
    kind: 'sql-db',
    label: 'SQL database',
    category: 'data',
    concept: 'Relational store with transactions and joins; scale reads with replicas, writes with sharding.',
    acceptsIncoming: true,
    params: [latency(10, 500), capacity(2_000, 50_000), replicas(1), { key: 'shards', label: 'Shards', min: 1, max: 64, step: 1, default: 1 }, availability(99.95)],
  },
  {
    kind: 'nosql-db',
    label: 'NoSQL database',
    category: 'data',
    concept: 'Key-value or document store that partitions data across nodes for huge write throughput.',
    acceptsIncoming: true,
    params: [latency(5, 500), capacity(10_000, 200_000), replicas(3), availability(99.9)],
  },
  {
    kind: 'object-storage',
    label: 'Object storage',
    category: 'data',
    concept: 'Cheap, durable blob storage (S3) for files, images and backups, usually fronted by a CDN.',
    acceptsIncoming: true,
    params: [latency(50, 1_000), capacity(5_000, 100_000), availability(99.99)],
  },
  {
    kind: 'search',
    label: 'Search index',
    category: 'data',
    concept: 'Inverted index (Elasticsearch) for full-text and faceted queries a database is bad at.',
    acceptsIncoming: true,
    params: [latency(20, 1_000), capacity(1_000, 50_000), replicas(2), availability(99.9)],
  },
  {
    kind: 'queue',
    label: 'Queue',
    category: 'messaging',
    concept: 'Buffers work between producers and consumers so spikes are smoothed instead of dropped.',
    acceptsIncoming: true,
    params: [latency(5, 100), capacity(20_000, 500_000), availability(99.95)],
  },
  {
    kind: 'stream',
    label: 'Event stream',
    category: 'messaging',
    concept: 'Durable, replayable log (Kafka) that many consumers read independently: pub/sub at scale.',
    acceptsIncoming: true,
    params: [latency(10, 200), capacity(100_000, 2_000_000), { key: 'partitions', label: 'Partitions', min: 1, max: 256, step: 1, default: 6 }, availability(99.95)],
  },
  {
    kind: 'external-api',
    label: 'External API',
    category: 'external',
    concept: 'A third-party dependency (payments, email, maps) whose latency and outages you do not control.',
    acceptsIncoming: true,
    params: [latency(150, 5_000), capacity(1_000, 100_000), availability(99.9)],
  },
]

export const catalog: Record<ComponentKind, ComponentSpec> = Object.fromEntries(
  specs.map((spec) => [spec.kind, spec]),
) as Record<ComponentKind, ComponentSpec>

export const componentKinds = specs.map((spec) => spec.kind)

export function isComponentKind(value: unknown): value is ComponentKind {
  return typeof value === 'string' && value in catalog
}

export function specsInCategory(category: Category): ComponentSpec[] {
  return specs.filter((spec) => spec.category === category)
}

/** Default parameter values for a kind, e.g. `{ latency: 30, capacity: 500, replicas: 3 }`. */
export function defaultParams(kind: ComponentKind): Record<string, number> {
  return Object.fromEntries(catalog[kind].params.map((p) => [p.key, p.default]))
}

/** Clamp to the spec's range and snap to its step, so stored values are always valid. */
export function clampParam(spec: ParamSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.default
  const clamped = Math.min(spec.max, Math.max(spec.min, value))
  const snapped = spec.min + Math.round((clamped - spec.min) / spec.step) * spec.step
  // Avoid 0.30000000000000004-style noise from fractional steps.
  return Number(Math.min(spec.max, snapped).toFixed(6))
}
