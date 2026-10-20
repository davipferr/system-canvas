import { useMemo, useState, type ReactNode } from 'react'
import { catalog, estimate, formatBytes, formatCount, type EstimateInput } from 'system-canvas'
import { Modal } from './Modal'

const presets: { name: string; input: EstimateInput }[] = [
  {
    name: 'Social feed',
    input: {
      dailyActiveUsers: 50_000_000,
      requestsPerUserPerDay: 30,
      readPercent: 95,
      peakFactor: 3,
      writeSizeKB: 1,
      readSizeKB: 10,
      retentionYears: 5,
      replication: 3,
      cacheHotPercent: 20,
    },
  },
  {
    name: 'URL shortener',
    input: {
      dailyActiveUsers: 10_000_000,
      requestsPerUserPerDay: 10,
      readPercent: 99,
      peakFactor: 2,
      writeSizeKB: 0.5,
      readSizeKB: 0.5,
      retentionYears: 5,
      replication: 3,
      cacheHotPercent: 20,
    },
  },
  {
    name: 'Chat',
    input: {
      dailyActiveUsers: 20_000_000,
      requestsPerUserPerDay: 100,
      readPercent: 50,
      peakFactor: 2,
      writeSizeKB: 0.2,
      readSizeKB: 2,
      retentionYears: 2,
      replication: 3,
      cacheHotPercent: 10,
    },
  },
]

const fields: { key: keyof EstimateInput; label: string; unit?: string; step: number }[] = [
  { key: 'dailyActiveUsers', label: 'Daily active users', step: 1000 },
  { key: 'requestsPerUserPerDay', label: 'Requests per user per day', step: 1 },
  { key: 'readPercent', label: 'Reads', unit: '%', step: 1 },
  { key: 'peakFactor', label: 'Peak ÷ average', unit: '×', step: 0.5 },
  { key: 'writeSizeKB', label: 'Data stored per write', unit: 'KB', step: 0.1 },
  { key: 'readSizeKB', label: 'Data returned per read', unit: 'KB', step: 1 },
  { key: 'retentionYears', label: 'Keep data for', unit: 'years', step: 1 },
  { key: 'replication', label: 'Copies of each byte', unit: '×', step: 1 },
  { key: 'cacheHotPercent', label: 'Hot share of reads to cache', unit: '%', step: 5 },
]

const rps = (n: number) => `${formatCount(n)} rps`
const perSecond = (bytes: number) => `${formatBytes(bytes)}/s`

/** The default capacity of one service replica, so the estimate speaks the canvas's language. */
const SERVER_RPS = catalog.service.params.find((p) => p.key === 'capacity')!.default

function Result({ label, value, formula }: { label: string; value: string; formula: ReactNode }) {
  return (
    <div className="estimate-result">
      <dt>{label}</dt>
      <dd>{value}</dd>
      <p className="muted">{formula}</p>
    </div>
  )
}

export function Estimator({
  open,
  onClose,
  onApply,
}: {
  open: boolean
  onClose: () => void
  /** Put this traffic on the canvas's clients. */
  onApply: (rps: number, readPercent: number) => void
}) {
  const [input, setInput] = useState<EstimateInput>(presets[0].input)
  const e = useMemo(() => estimate(input), [input])
  const servers = Math.ceil(e.peakRps / SERVER_RPS)

  return (
    <Modal open={open} onClose={onClose} title="Back-of-the-envelope estimate">
      <p className="muted small">
        Start from users and behaviour, end with the numbers a design has to handle. Decimal units (1 KB = 1,000
        bytes) and 86,400 seconds a day: the point is the order of magnitude.
      </p>
      <div className="chips">
        {presets.map((p) => (
          <button
            key={p.name}
            className={p.input === input ? 'chip active' : 'chip'}
            onClick={() => setInput(p.input)}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div className="estimator">
        <div className="estimate-inputs">
          {fields.map((f) => (
            <label key={f.key} className="estimate-field">
              <span>{f.label}</span>
              <span className="param-value">
                <input
                  type="number"
                  min={0}
                  step={f.step}
                  value={input[f.key]}
                  onChange={(ev) => {
                    const value = Number(ev.target.value)
                    if (ev.target.value !== '' && Number.isFinite(value) && value >= 0) {
                      setInput({ ...input, [f.key]: f.key === 'readPercent' ? Math.min(100, value) : value })
                    }
                  }}
                />
                <span className="muted unit">{f.unit}</span>
              </span>
            </label>
          ))}
        </div>

        <dl className="estimate-results">
          <Result
            label="Requests per day"
            value={formatCount(e.requestsPerDay)}
            formula={`${formatCount(input.dailyActiveUsers)} users × ${input.requestsPerUserPerDay}`}
          />
          <Result
            label="Average traffic"
            value={rps(e.averageRps)}
            formula={`${formatCount(e.requestsPerDay)} ÷ 86,400 s`}
          />
          <Result
            label="Peak traffic"
            value={rps(e.peakRps)}
            formula={`${rps(e.averageRps)} × ${input.peakFactor}: ${rps(e.peakReadRps)} reads, ${rps(e.peakWriteRps)} writes`}
          />
          <Result
            label="App servers at peak"
            value={`≈ ${formatCount(servers)}`}
            formula={`${rps(e.peakRps)} ÷ ${SERVER_RPS} rps per server, before headroom`}
          />
          <Result
            label="New data per day"
            value={formatBytes(e.storagePerDay)}
            formula={`${formatCount(e.writesPerDay)} writes × ${input.writeSizeKB} KB`}
          />
          <Result
            label={`Storage for ${input.retentionYears} years`}
            value={formatBytes(e.storageTotal)}
            formula={`${formatBytes(e.storagePerDay)} × 365 × ${input.retentionYears} × ${input.replication} copies`}
          />
          <Result
            label="Bandwidth in / out"
            value={`${perSecond(e.ingressPerSecond)} / ${perSecond(e.egressPerSecond)}`}
            formula={`out at peak: ${perSecond(e.peakEgressPerSecond)}`}
          />
          <Result
            label="Cache memory"
            value={formatBytes(e.cacheSize)}
            formula={`${input.cacheHotPercent}% of a day's reads (${formatCount(e.readsPerDay)} × ${input.readSizeKB} KB)`}
          />
        </dl>
      </div>

      <div className="estimate-apply">
        <button className="primary" onClick={() => onApply(e.peakRps, input.readPercent)} disabled={e.peakRps <= 0}>
          Put peak traffic on the canvas
        </button>
        <span className="muted small">
          Sets the clients to {rps(e.peakRps)} with {input.readPercent}% reads, then try Simulate.
        </span>
      </div>
    </Modal>
  )
}
