# System Canvas

A static site for learning and practising **System Design** by building architectures and
watching them behave. Drop components (load balancers, services, caches, databases, queues,
CDNs...) on a canvas and wire them together. Then push simulated traffic through the design to
see latency, bottlenecks, failures and availability, with every number explained.

It has no backend: everything runs in the browser, and your work is saved there.

## A learning path

1. **Open the Library → Templates** and read a classic design (URL shortener, news feed, chat...).
   Its notes explain the key ideas, and the inspector explains every component.
2. **Press S to simulate.** Raise the load multiplier until something breaks, and read why in the
   inspector (the queueing formula is filled in with real numbers).
3. **Press X on a component** to fail it. See what users lose, and which parts are single points
   of failure.
4. **Play the Challenges.** Each one starts broken, and its goals are checked live. Hints and a
   reference solution are there when you are stuck.
5. **Design your own.** Start with **Estimate** (users → requests per second, storage and
   bandwidth), put the peak traffic on the canvas, and build until it holds. Keep your reasoning
   in the design's **Notes**, and **Export** it as JSON, SVG or PNG.

## Features

**Editing**

- Drag components from the palette (or click one to add it in the middle of the view), drag
  them around (positions snap to a 20 px grid), and connect them by dragging from a component's
  right-hand dot onto another. Impossible connections are refused with a reason.
- Pan by dragging the background, zoom with the wheel or the zoom bar, and press **F** to fit.
- The inspector edits names, parameters (sliders plus exact numbers; log-scale sliders for wide
  ranges, "nines" for availability) and connection labels.
- Undo/redo for everything, with drags and typing grouped into single steps.
- Autosave in the browser. Export and import designs as JSON, and export the canvas as SVG or PNG.

**Simulation** (button or **S**)

- Requests flow along connections as dots: blue reads, yellow writes, hollow when async. Busier
  connections are thicker, and each is labelled with its requests per second.
- Components show their utilization as a percentage and a bar: green below 70%, orange up to 100%,
  pulsing red when overloaded. Badges show requests being dropped or a queue backlog growing.
- The **Live traffic** panel has a load multiplier (×0.1 to ×20), response time, availability,
  drops, backlog, and **"first to break: X at ×1.6"**.

**Failures and availability**

- Fail any component (**X**) and see what breaks. Load balancers and queues route around dead
  targets; other components don't.
- System availability, expected downtime per year, and single points of failure ranked by how many
  requests each would cost, tagged **SPOF** on the canvas.

**Learning content**

- Six **templates** with notes, five **challenges** with live goal checks (throughput, response
  time, availability, no SPOFs, no backlog, utilization headroom, a monthly budget), and a
  **back-of-the-envelope estimator** that shows its formulas.
- A rough **monthly cost** for each component and the whole design, so scaling has a price.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Delete / Backspace | Remove the selected component or connection |
| Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) | Undo / redo |
| F | Fit the design in view |
| S | Start / stop the simulation |
| X | Fail / restore the selected component |
| E | Open the estimator |
| Escape | Deselect, or close a dialog |

## How the numbers work

The models use steady averages and no randomness, so every number can be checked by hand.
They are teaching models, not capacity planners (see [Limits](#limits)).

### Traffic

`simulate(design)` pushes every client's requests through the design.

- **Reads and writes.** A client sends `rps` requests, `Reads %` of them reads. A connection
  labelled `reads` carries only reads, and one labelled `writes` only writes.
- **Each kind moves traffic in one of four ways:**

  | Behaviour | Kinds | What happens |
  | --- | --- | --- |
  | split | client, DNS, load balancer, API gateway, queue | each request goes to **one** connection, spread evenly |
  | fan-out | service, worker, event stream, external API | each request calls **every** connection |
  | cache | cache, CDN | the hit rate of reads is answered here, misses and writes go on |
  | store | SQL, NoSQL, object storage, search | everything is answered here, only writes go on (replication) |

  So a queue's consumers share the jobs (competing consumers), while every subscriber of an
  event stream gets every event (pub/sub).
- **Capacity** = capacity per replica × replicas (× shards). SQL read replicas only add read
  capacity: every write still hits the primary.
- **Queueing.** At utilization ρ a component answers in `latency / (1 − ρ)` (M/M/1):
  2× at 50% busy, 10× at 90%, exploding near 100%.
- **Overload.** Past 100% a component serves only its capacity and drops the rest, or builds a
  backlog if a queue feeds it. Only served traffic flows on, so one bottleneck hides the load
  behind it.
- **Response time** = own latency + the synchronous calls an average request makes, weighted by
  the share of requests that take each one. Connections labelled `async` or `events`, and
  everything a queue or stream sends out, don't count.
- **Load testing.** `scaleTraffic` multiplies the traffic. `breakingPoint` simulates once with
  unlimited capacity, which is exact because every rule is linear until something saturates, to
  find the first component that hits 100% and at what multiple of today's traffic.
- **Loops** are cut at the connection that turns back towards the users, with a warning.

### Availability

`analyzeAvailability(design, { failed })` gives the share of requests that succeed. It comes down
to two rules:

- **Series** (needs A *and then* B): availabilities multiply. 99.9% × 99.9% = 99.8%.
- **Parallel** (any copy will do): *downtimes* multiply. 1 − (1 − 99.5%)³ = 99.99999%.

Every component has an availability per instance. A component is its replicas in parallel and its
shards in series. A load balancer's targets back each other up, so they are in parallel. Other
dependencies count only for the share of requests that call them, so a cache hit never depends
on the database. Reads and writes are worked out separately, because a request is one or the
other. Async work is ignored, because users don't wait for it.

A **single point of failure** is a single-instance component (DNS, CDN and object storage are
distributed by design) whose failure would cost at least 1% of requests.

### Estimation and cost

`estimate(input)` is the classic back-of-the-envelope calculation:
users × requests ÷ 86,400 = average rps, × the peak factor = peak rps. Storage is
writes × size × 365 × years × copies. Bandwidth is reads × response size. The cache holds the
hot share of a day's reads. It uses decimal units (1 KB = 1,000 bytes).

`monthlyCost(design)` uses round, ballpark prices per instance. Only the ratios matter: a
database replica costs about 4× an app server.

### Limits

- Averages only: no bursts, no tail latency (p99), no retries, timeouts or retry storms.
- A request either succeeds or fails. There is no partial degradation, fallback logic or
  circuit breaker.
- No network distance between components (regions, cross-zone latency), and no data
  consistency model.
- Fan-out on write counts one write per post, not one per follower.

These are good next questions to ask about any design the simulator says is fine.

## Project structure

| Path | What lives there |
| --- | --- |
| [`src/`](src) | The engine: pure TypeScript, no React, imported by the site as `system-canvas` |
| [`src/catalog.ts`](src/catalog.ts) | Component kinds, their concept notes and tunable parameters |
| [`src/design.ts`](src/design.ts) | The design graph, its pure operations, and validated JSON (de)serialization |
| [`src/history.ts`](src/history.ts) | Undo/redo as data, with gesture and typing merges |
| [`src/simulate.ts`](src/simulate.ts) | Traffic model, failures, load scaling, breaking point |
| [`src/availability.ts`](src/availability.ts) | Availability, failure impact, single points of failure |
| [`src/estimate.ts`](src/estimate.ts) | Back-of-the-envelope estimation and unit formatting |
| [`src/cost.ts`](src/cost.ts), [`src/goals.ts`](src/goals.ts) | Monthly cost, and the goal checker behind the challenges |
| [`playground/`](playground) | The site: React + SVG |
| [`playground/templates.ts`](playground/templates.ts), [`playground/challenges.ts`](playground/challenges.ts) | Built-in learning content |

`src/content.test.ts` keeps the learning content honest. Every template must simulate with
nothing overloaded, idle, looping or backed up. Every challenge must start out failing, and its
reference solution must pass every goal.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server for the site |
| `npm test` | Vitest: the engine plus the built-in templates and challenges |
| `npm run typecheck` | `tsc --noEmit` over engine and site |
| `npm run build` | Static site into `dist/` (relative paths, so it works from any folder) |
| `npm run preview` | Serve the built `dist/` locally |

## Deploying to GitHub Pages

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) tests, type-checks and builds every push
and pull request. Pushes to `main` are also deployed to GitHub Pages. To turn it on, go to
**Settings → Pages → Build and deployment → Source** in the repository and choose
**GitHub Actions**. Because asset paths are relative (`base: './'`), the site works at
`https://<user>.github.io/<repo>/` without configuration.
