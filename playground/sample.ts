import type { Design } from 'system-canvas'
import { blueprint } from './blueprint'

/**
 * The classic starting point: a read-heavy web app. Static files come from a CDN, API reads go
 * through a read-through cache, writes hit Postgres and also queue an email for a worker.
 * The numbers start healthy, so changing one knob shows its effect.
 */
export function sampleDesign(): Design {
  return blueprint(
    'Read-heavy web app',
    [
      'Most traffic is reads (90%), so the design is built to keep reads away from the database.',
      '• Static files come from a CDN; only cache misses reach object storage.',
      '• API reads go through a read-through cache. Only misses (20%) reach Postgres.',
      '• Writes go to Postgres and queue an email. The Mailer works off the queue, so users never wait for it.',
      'Try: lower the API replicas, raise the traffic in Simulate, or fail the cache.',
    ].join('\n'),
    (b) => {
      const users = b.place('client', 0, 1.5, 'Users', { rps: 5_000 })
      const cdn = b.place('cdn', 1, 0.2)
      const assets = b.place('object-storage', 2, 0.2, 'Static assets')
      const lb = b.place('load-balancer', 1, 2)
      const api = b.place('service', 2, 2, 'API', { replicas: 10 })
      const cache = b.place('cache', 3, 1.1)
      const db = b.place('sql-db', 4, 2, 'Postgres')
      const queue = b.place('queue', 2, 3.6, 'Email jobs')
      const worker = b.place('worker', 3, 4.2, 'Mailer', { replicas: 8 })
      const email = b.place('external-api', 4, 4.2, 'Email provider')

      b.link(users, cdn, 'reads')
      b.link(cdn, assets, 'miss')
      b.link(users, lb, 'api')
      b.link(lb, api)
      b.link(api, cache, 'reads')
      b.link(cache, db, 'miss')
      b.link(api, db, 'writes')
      b.link(api, queue, 'writes')
      b.link(queue, worker)
      b.link(worker, email)
    },
  )
}
