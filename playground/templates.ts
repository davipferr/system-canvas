import type { Design } from 'system-canvas'
import { blueprint } from './blueprint'
import { sampleDesign } from './sample'

export interface Template {
  id: string
  name: string
  /** One line for the library card. */
  summary: string
  /** The concepts this design shows off. */
  concepts: string[]
  build: () => Design
}

const notes = (...lines: string[]) => lines.join('\n')

export const templates: Template[] = [
  {
    id: 'web-app',
    name: 'Read-heavy web app',
    summary: 'CDN, load balancer, read-through cache, database and an email queue.',
    concepts: ['CDN', 'read-through cache', 'async jobs'],
    build: sampleDesign,
  },
  {
    id: 'url-shortener',
    name: 'URL shortener',
    summary: '20k redirects per second, 100 reads for every write, answered from cache.',
    concepts: ['key-value store', 'cache hit rate', 'ID generation'],
    build: () =>
      blueprint(
        'URL shortener',
        notes(
          'Requirements: 20,000 requests/s, 99% are redirects (reads), 1% create a short link.',
          '• Redirects are tiny, hot and immutable: perfect for a cache. 95% never reach storage.',
          '• Short codes come from an ID generator (a counter encoded in base62), so two servers never hand out the same code.',
          '• A key-value (NoSQL) store fits: one lookup by key, no joins, and it partitions evenly by code.',
          'Question to explore: what happens to the store if the cache hit rate drops to 50%?',
        ),
        (b) => {
          const users = b.place('client', 0, 1, 'Users', { rps: 20_000, readRatio: 99 })
          const lb = b.place('load-balancer', 1, 1)
          const api = b.place('service', 2, 1, 'Shortener API', { latency: 10, capacity: 2_000, replicas: 15 })
          const cache = b.place('cache', 3, 0, 'Redirect cache', { hitRate: 95, replicas: 2 })
          const ids = b.place('service', 3, 2.2, 'ID generator', { latency: 2, capacity: 5_000, replicas: 2 })
          const store = b.place('nosql-db', 4, 1, 'URL store')
          b.link(users, lb)
          b.link(lb, api)
          b.link(api, cache, 'reads')
          b.link(cache, store, 'miss')
          b.link(api, ids, 'writes')
          b.link(api, store, 'writes')
        },
      ),
  },
  {
    id: 'news-feed',
    name: 'News feed',
    summary: 'Fan-out on write: posts are pushed into precomputed timelines by workers.',
    concepts: ['fan-out on write', 'event stream', 'precomputed reads'],
    build: () =>
      blueprint(
        'News feed',
        notes(
          'Requirements: 10,000 requests/s, 95% are people scrolling their feed.',
          '• Fan-out on write: when someone posts, workers copy the post into every follower\'s timeline in the cache. Reading a feed is then one cache lookup.',
          '• The post is saved first, then published to an event stream; the user never waits for the fan-out.',
          '• Trade-off: a celebrity with 10M followers makes one post cost 10M writes. Real systems switch to fan-out on read for those accounts.',
          'The model counts one cache write per post; imagine multiplying it by the follower count.',
        ),
        (b) => {
          const users = b.place('client', 0, 1, 'Users', { rps: 10_000, readRatio: 95 })
          const lb = b.place('load-balancer', 1, 1)
          const api = b.place('service', 2, 1, 'Feed API', { latency: 20, capacity: 1_000, replicas: 15 })
          const timelines = b.place('cache', 3, 0, 'Timeline cache', { hitRate: 98, replicas: 3 })
          const posts = b.place('nosql-db', 4, 1, 'Posts DB')
          const events = b.place('stream', 3, 2.2, 'Post events')
          const fanout = b.place('worker', 4, 2.2, 'Fan-out workers', { latency: 50, capacity: 200, replicas: 5 })
          b.link(users, lb)
          b.link(lb, api)
          b.link(api, timelines, 'reads')
          b.link(timelines, posts, 'reads')
          b.link(api, posts, 'writes')
          b.link(api, events, 'writes')
          b.link(events, fanout)
          b.link(fanout, timelines, 'writes')
        },
      ),
  },
  {
    id: 'chat',
    name: 'Chat',
    summary: 'WebSocket gateways, a durable message log, delivery workers and push notifications.',
    concepts: ['persistent connections', 'message log', 'delivery guarantees'],
    build: () =>
      blueprint(
        'Chat',
        notes(
          'Requirements: 8,000 requests/s, half are messages sent, half are loading history.',
          '• Clients keep a WebSocket open to a gateway, so the server can push messages instantly.',
          '• Every message is stored, then appended to a durable log (event stream). Delivery workers read the log and push to recipients, retrying until it lands: at-least-once delivery.',
          '• Offline users get a push notification through an external provider, which is async so its outages never block sending.',
          '• Recent history is cached per conversation; older pages come from the message store.',
        ),
        (b) => {
          const users = b.place('client', 0, 1, 'Users', { rps: 8_000, readRatio: 50 })
          const lb = b.place('load-balancer', 1, 1)
          const gateway = b.place('service', 2, 1, 'Chat gateway', { latency: 10, capacity: 1_000, replicas: 12 })
          const recent = b.place('cache', 3, 0, 'Recent messages', { hitRate: 90, replicas: 2 })
          const store = b.place('nosql-db', 4, 1, 'Message store')
          const log = b.place('stream', 3, 2.2, 'Message log')
          const delivery = b.place('worker', 4, 2.2, 'Delivery workers', { latency: 20, capacity: 500, replicas: 10 })
          const push = b.place('external-api', 5, 2.2, 'Push provider', { capacity: 10_000 })
          b.link(users, lb)
          b.link(lb, gateway)
          b.link(gateway, recent, 'reads')
          b.link(recent, store, 'reads')
          b.link(gateway, store, 'writes')
          b.link(gateway, log, 'writes')
          b.link(log, delivery)
          b.link(delivery, push)
        },
      ),
  },
  {
    id: 'checkout',
    name: 'E-commerce checkout',
    summary: 'Separate read and write paths behind a gateway, with payments and order emails.',
    concepts: ['read/write split', 'third-party risk', 'search index'],
    build: () =>
      blueprint(
        'E-commerce checkout',
        notes(
          'Requirements: 6,000 requests/s; 85% browse the catalog, 15% place orders.',
          '• Browsing and ordering are separate services that scale on their own: catalog reads are cached and searched, orders write to their own database.',
          '• The payment provider is called synchronously, because the user must know if they paid. That makes it a single point of failure you cannot add replicas to. Fail it and see what breaks.',
          '• Retries need idempotency keys, so a timeout never charges a card twice.',
          '• Confirmation emails go through a queue: slow or down email never blocks checkout.',
        ),
        (b) => {
          const users = b.place('client', 0, 1.5, 'Shoppers', { rps: 6_000, readRatio: 85 })
          const cdn = b.place('cdn', 1, 0, 'Image CDN')
          const images = b.place('object-storage', 2, 0, 'Product images')
          const gateway = b.place('api-gateway', 1, 2)
          const catalog = b.place('service', 2, 1.2, 'Catalog', { capacity: 800, replicas: 6 })
          const productCache = b.place('cache', 3, 0.6, 'Product cache', { hitRate: 90 })
          const search = b.place('search', 3, 1.8, 'Product search', { replicas: 4 })
          const products = b.place('sql-db', 4, 0.6, 'Products DB')
          const orders = b.place('service', 2, 3, 'Orders', { replicas: 3 })
          const ordersDb = b.place('sql-db', 3, 3, 'Orders DB')
          const payments = b.place('external-api', 3, 4, 'Payments', { capacity: 5_000 })
          const events = b.place('queue', 4, 3, 'Order events')
          const mailer = b.place('worker', 5, 3, 'Email worker', { capacity: 1_000, replicas: 2 })
          const email = b.place('external-api', 5, 4, 'Email provider', { capacity: 5_000 })
          b.link(users, cdn, 'reads')
          b.link(cdn, images, 'miss')
          b.link(users, gateway)
          b.link(gateway, catalog, 'reads')
          b.link(gateway, orders, 'writes')
          b.link(catalog, productCache, 'reads')
          b.link(productCache, products, 'miss')
          b.link(catalog, search, 'reads')
          b.link(orders, ordersDb, 'writes')
          b.link(orders, payments, 'writes')
          b.link(orders, events, 'writes')
          b.link(events, mailer)
          b.link(mailer, email)
        },
      ),
  },
  {
    id: 'video',
    name: 'Video streaming',
    summary: 'The CDN serves the bytes; uploads go to storage and a transcoding queue.',
    concepts: ['CDN offload', 'object storage', 'slow background jobs'],
    build: () =>
      blueprint(
        'Video streaming',
        notes(
          'Requirements: 30,000 requests/s, almost all of them watching (99% reads).',
          '• Video bytes never touch your servers: players fetch segments from the CDN, and only misses reach object storage.',
          '• The API only handles metadata (titles, thumbnails, watch history), which is small and cacheable.',
          '• An upload is stored as-is, then a transcoding job turns it into several resolutions for adaptive bitrate. Transcoding takes seconds per job, so it runs on a queue with its own workers.',
        ),
        (b) => {
          const viewers = b.place('client', 0, 1.5, 'Viewers', { rps: 30_000, readRatio: 99 })
          const cdn = b.place('cdn', 1, 0, 'Video CDN', { hitRate: 95 })
          const storage = b.place('object-storage', 4, 0, 'Video storage')
          const lb = b.place('load-balancer', 1, 2)
          const api = b.place('service', 2, 2, 'Video API', { latency: 15, capacity: 2_000, replicas: 12 })
          const metaCache = b.place('cache', 3, 1.2, 'Metadata cache', { hitRate: 95 })
          const metaDb = b.place('sql-db', 4, 1.2, 'Metadata DB')
          const jobs = b.place('queue', 2, 3.3, 'Transcode jobs')
          const transcoders = b.place('worker', 3, 3.3, 'Transcoders', { latency: 3_000, capacity: 50, replicas: 8 })
          b.link(viewers, cdn, 'reads')
          b.link(cdn, storage, 'miss')
          b.link(viewers, lb)
          b.link(lb, api)
          b.link(api, metaCache, 'reads')
          b.link(metaCache, metaDb, 'miss')
          b.link(api, storage, 'writes')
          b.link(api, jobs, 'writes')
          b.link(jobs, transcoders)
        },
      ),
  },
]
