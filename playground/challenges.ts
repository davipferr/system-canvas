import type { Design, Goals } from 'system-canvas'
import { blueprint } from './blueprint'

export interface Challenge {
  id: string
  name: string
  /** What the user has to do, in a sentence or two. */
  brief: string
  difficulty: 'easy' | 'medium' | 'hard'
  goals: Goals
  /** Revealed one at a time. */
  hints: string[]
  /** The broken design the challenge starts from. */
  start: () => Design
  /** One design that meets every goal (there are others). Tests keep it honest. */
  solution: () => Design
}

const notes = (...lines: string[]) => lines.join('\n')

export const challenges: Challenge[] = [
  {
    id: 'scale-out',
    name: 'Survive the launch',
    brief: 'Your app is on the front page. One server and one database have to become a system that serves 3,000 requests per second, quickly.',
    difficulty: 'easy',
    goals: { rps: 3_000, readRatio: 90, noDrops: true, maxResponseTime: 120, maxCost: 1_500 },
    hints: [
      'One API server handles 500 rps. You need several, and a load balancer to spread requests across them.',
      'Watch the latency: at 90% busy a server is 10× slower than at idle. Leave headroom.',
      'Postgres is next. Read replicas share the reads, or a cache can keep most reads away from it.',
    ],
    start: () =>
      blueprint('Survive the launch', notes('Start: one API server, one database. Make it serve 3,000 rps.'), (b) => {
        const users = b.place('client', 0, 1, 'Users')
        const api = b.place('service', 1, 1, 'API', { replicas: 1 })
        const db = b.place('sql-db', 2, 1, 'Postgres')
        b.link(users, api)
        b.link(api, db)
      }),
    solution: () =>
      blueprint('Survive the launch: a solution', notes('Load balancer + 10 API replicas, and a cache in front of Postgres.'), (b) => {
        const users = b.place('client', 0, 1, 'Users')
        const lb = b.place('load-balancer', 1, 1)
        const api = b.place('service', 2, 1, 'API', { replicas: 10 })
        const cache = b.place('cache', 3, 0)
        const db = b.place('sql-db', 4, 1, 'Postgres')
        b.link(users, lb)
        b.link(lb, api)
        b.link(api, cache, 'reads')
        b.link(cache, db, 'miss')
        b.link(api, db, 'writes')
      }),
  },
  {
    id: 'cache',
    name: 'Cache is king',
    brief: '20,000 requests per second, 95% reads, on a budget. Scaling the database alone is not affordable.',
    difficulty: 'medium',
    goals: { rps: 20_000, readRatio: 95, noDrops: true, maxResponseTime: 60, maxCost: 2_500, requires: ['cache'] },
    hints: [
      'A SQL replica costs $200 a month and serves 2,000 rps. Count how many 19,000 reads would need.',
      'A cache node costs $50 and serves 50,000 rps. Label the API → cache connection "reads", and send the cache\'s misses on to the database.',
      'Writes still go to the database, and replicas do not help writes. Keep its utilization well under 100%.',
    ],
    start: () =>
      blueprint('Cache is king', notes('Start: the API is fast, but every read hits Postgres.'), (b) => {
        const users = b.place('client', 0, 1, 'Users')
        const lb = b.place('load-balancer', 1, 1)
        const api = b.place('service', 2, 1, 'API', { latency: 10, capacity: 2_000, replicas: 10 })
        const db = b.place('sql-db', 3, 1, 'Postgres')
        b.link(users, lb)
        b.link(lb, api)
        b.link(api, db)
      }),
    solution: () =>
      blueprint('Cache is king: a solution', notes('Cache with a 95% hit rate, 14 API replicas, 2 database replicas.'), (b) => {
        const users = b.place('client', 0, 1, 'Users')
        const lb = b.place('load-balancer', 1, 1)
        const api = b.place('service', 2, 1, 'API', { latency: 10, capacity: 2_000, replicas: 14 })
        const cache = b.place('cache', 3, 0, 'Cache', { hitRate: 95 })
        const db = b.place('sql-db', 4, 1, 'Postgres', { replicas: 2 })
        b.link(users, lb)
        b.link(lb, api)
        b.link(api, cache, 'reads')
        b.link(cache, db, 'miss')
        b.link(api, db, 'writes')
      }),
  },
  {
    id: 'no-spof',
    name: 'No single point of failure',
    brief: 'The system works, but any one machine dying takes users down with it. Reach 99.95% availability with no single point of failure.',
    difficulty: 'medium',
    goals: { rps: 2_000, readRatio: 90, noDrops: true, minAvailability: 0.9995, noSpof: true, maxCost: 1_500 },
    hints: [
      'Select the components tagged SPOF: each runs as a single instance.',
      'Replicas multiply downtime: two 99.9% caches are down together only 0.0001% of the time.',
      'Press X on a component to fail it and check that users barely notice.',
    ],
    start: () =>
      blueprint('No single point of failure', notes('Start: everything except the API runs as one instance.'), (b) => {
        const users = b.place('client', 0, 1, 'Users')
        const lb = b.place('load-balancer', 1, 1, 'Load balancer', { replicas: 1 })
        const api = b.place('service', 2, 1, 'API', { replicas: 5 })
        const cache = b.place('cache', 3, 0, 'Cache', { replicas: 1 })
        const db = b.place('sql-db', 4, 1, 'Postgres', { replicas: 1 })
        b.link(users, lb)
        b.link(lb, api)
        b.link(api, cache, 'reads')
        b.link(cache, db, 'miss')
        b.link(api, db, 'writes')
      }),
    solution: () =>
      blueprint('No single point of failure: a solution', notes('Two of everything that was single.'), (b) => {
        const users = b.place('client', 0, 1, 'Users')
        const lb = b.place('load-balancer', 1, 1, 'Load balancer', { replicas: 2 })
        const api = b.place('service', 2, 1, 'API', { replicas: 5 })
        const cache = b.place('cache', 3, 0, 'Cache', { replicas: 2 })
        const db = b.place('sql-db', 4, 1, 'Postgres', { replicas: 2 })
        b.link(users, lb)
        b.link(lb, api)
        b.link(api, cache, 'reads')
        b.link(cache, db, 'miss')
        b.link(api, db, 'writes')
      }),
  },
  {
    id: 'async',
    name: "Don't make users wait",
    brief: 'Every upload is resized while the user waits, and the resizer cannot keep up. Answer in under 80 ms and still process every image.',
    difficulty: 'medium',
    goals: {
      rps: 3_000,
      readRatio: 50,
      noDrops: true,
      noBacklog: true,
      maxResponseTime: 80,
      maxCost: 2_000,
      requires: ['queue'],
    },
    hints: [
      'The user only needs to know the upload was accepted, not that it was resized.',
      'Put a queue between the API and the resizer: enqueueing takes milliseconds, and anything after a queue is async.',
      'Async is not free: the workers still have to keep up on average, or the backlog grows forever.',
    ],
    start: () =>
      blueprint("Don't make users wait", notes('Start: uploads (writes) call the image resizer synchronously.'), (b) => {
        const users = b.place('client', 0, 1, 'Users')
        const lb = b.place('load-balancer', 1, 1)
        const api = b.place('service', 2, 1, 'API', { latency: 15, replicas: 10 })
        const resizer = b.place('worker', 3, 1, 'Image resizer', { latency: 400, capacity: 100, replicas: 10 })
        const storage = b.place('object-storage', 4, 1, 'Images')
        b.link(users, lb)
        b.link(lb, api)
        b.link(api, resizer, 'writes')
        b.link(resizer, storage)
      }),
    solution: () =>
      blueprint("Don't make users wait: a solution", notes('Uploads are queued; 20 resizers work through them.'), (b) => {
        const users = b.place('client', 0, 1, 'Users')
        const lb = b.place('load-balancer', 1, 1)
        const api = b.place('service', 2, 1, 'API', { latency: 15, replicas: 10 })
        const queue = b.place('queue', 3, 1, 'Resize jobs')
        const resizer = b.place('worker', 4, 1, 'Image resizer', { latency: 400, capacity: 100, replicas: 20 })
        const storage = b.place('object-storage', 5, 1, 'Images')
        b.link(users, lb)
        b.link(lb, api)
        b.link(api, queue, 'writes')
        b.link(queue, resizer)
        b.link(resizer, storage)
      }),
  },
  {
    id: 'cdn',
    name: 'Static at scale',
    brief: '50,000 requests per second, almost all for static files. Serve them fast and cheaply, and keep every component under 75% busy.',
    difficulty: 'hard',
    goals: {
      rps: 50_000,
      readRatio: 98,
      noDrops: true,
      maxResponseTime: 60,
      maxUtilization: 0.75,
      maxCost: 1_000,
      requires: ['cdn'],
    },
    hints: [
      '50,000 rps through web servers at 500 rps each is 100 servers: $6,000 a month.',
      'A CDN answers reads at the edge. Label the client → CDN connection "reads" and the client → load balancer connection "writes", so each path only gets its kind of request.',
      'Only CDN misses reach object storage. Check its utilization against the 75% limit.',
    ],
    start: () =>
      blueprint('Static at scale', notes('Start: web servers serve every file from object storage.'), (b) => {
        const users = b.place('client', 0, 1, 'Users')
        const lb = b.place('load-balancer', 1, 1)
        const web = b.place('service', 2, 1, 'Web servers', { replicas: 10 })
        const files = b.place('object-storage', 3, 1, 'Files')
        b.link(users, lb)
        b.link(lb, web)
        b.link(web, files)
      }),
    solution: () =>
      blueprint('Static at scale: a solution', notes('Reads go to the CDN; only uploads reach the web servers.'), (b) => {
        const users = b.place('client', 0, 1, 'Users')
        const cdn = b.place('cdn', 1, 0, 'CDN', { hitRate: 95, capacity: 200_000 })
        const lb = b.place('load-balancer', 1, 2)
        const web = b.place('service', 2, 2, 'Web servers', { replicas: 4 })
        const files = b.place('object-storage', 3, 1, 'Files', { capacity: 10_000 })
        b.link(users, cdn, 'reads')
        b.link(cdn, files, 'miss')
        b.link(users, lb, 'writes')
        b.link(lb, web)
        b.link(web, files)
      }),
  },
]
