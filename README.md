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
5. **Run a game day.** Let the site break your design in secret and see how quickly you can find
   and fix it with your dashboards, alerts and traces.
6. **Design your own.** Start with **Estimate** (users → requests per second, storage and
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
- The **Live traffic** panel (collapsed to one line until you open it) has a load multiplier
  (×0.1 to ×20), p99 latency, error budget burn, availability, drops, backlog, and
  **"first to break: X at ×1.6"**.
- A **simulated clock** runs at 1 min/s, 10 min/s or 1 h/s, with a **traffic pattern**: steady, a
  daily cycle (30% at 08:00, peak at 20:00), a 3× spike at half past every hour, or a ramp from
  0.5× to 2× each hour. The canvas follows the clock live.
- A **dashboard** below the canvas charts the golden signals over time, Grafana-style: traffic,
  p50/p99 latency against the SLO line, error rate against the error budget, and the busiest
  component's saturation against 100%. A second row charts the selected component. One crosshair
  moves through every chart, and markers show when components failed or recovered, when the
  pattern changed, and when an alert paged.
- The dashboard's **Alerts** tab holds alert rules that fire and resolve as the clock runs: error
  budget burning fast (page) or slowly (ticket), latency over the SLO (page), a component running
  hot, a queue falling behind, a component down (tickets). Turn rules on and off, tune their
  thresholds and durations, and read the incident log. A page interrupts you with a toast.
- The **Traces** tab shows one request as a waterfall of spans: a read or a write, picked as a
  typical (p50), slow (p99), failing or random example. Bars nest by call, the darker part is a
  component's own work, async spans are dashed and run past the "response sent" line, and failed
  spans are red all the way up to the user. "Where the time went" ranks the components by their
  share of the user's wait. Click a span to select that component.
- **🎲 Game day** (dashboard header): a hidden fault hits your design a few minutes in. A component
  crashes, gets 8× slower or loses 70% of its capacity, a cache is flushed, or traffic triples, picked
  at random from the faults that would really break your SLOs. Find it with the dashboard, alerts and
  traces, then name it in the incident panel (each wrong guess adds 5 minutes). A correct diagnosis
  unlocks the remedy (restart, roll back, warm the cache, rate-limit), or you can fix it by changing
  the design. Once the SLOs have held for 5 minutes, a **postmortem** shows the timeline, time to
  detect, time to recover, when your alerts paged, and how much of the month's error budget it used.

**Failures and availability**

- Fail any component (**X**) and see what breaks. Load balancers and queues route around dead
  targets; other components don't.
- System availability, expected downtime per year, and single points of failure ranked by how many
  requests each would cost, tagged **SPOF** on the canvas.

**SRE: golden signals, SLOs and error budgets**

- Every component shows the **four golden signals**: latency (average and p99), traffic, errors
  (as its callers see them, including failures further down) and saturation.
- Each design has **SLOs**, saved with it: an availability target (e.g. 99.9%) and a latency target
  (e.g. p99 ≤ 300 ms). The inspector checks both, shows p50/p95/p99, and turns the availability
  target into an **error budget** (99.9% → about 43 minutes of outage per 30 days).
- It shows how much of that budget ordinary component failures use up, and the live **burn rate**:
  fail a component and see "burning 186×, the month's budget is gone in 4 h".

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

### Percentiles, SLOs and error budgets

SLOs are written as percentiles because users feel the slow tail, not the average.
`sampleRequests(design, sim)` follows 20,000 sample requests through the live simulation, with a
fixed seed so the numbers only change when the design does:

- Each request is a read or a write, takes cache hits or misses, load-balancer targets and
  dependencies with the same shares the traffic model computed, and skips async work.
- At each component it waits a random time from the queueing model. An M/M/1 queue's waiting time
  is exponential, so per component **p99 = average × ln(100) ≈ 4.6 × average**.
- It fails if it reaches a component that is down or turning requests away. Every component on
  the way up counts that failure as one of its errors, as its callers would see it.

A test checks that the sampled requests average to the traffic model's response time.

`evaluateSlo(slo, expectedAvailability, sample)` then reports:

- **Error budget** = 1 − availability target, over a 30-day window. 99.9% allows 0.1% of
  requests to fail, about 43 minutes of full outage.
- **Expected budget use**: how much of it ordinary component failures consume
  (1 − expected availability) ÷ budget. Above 100%, the design can't meet the target even in a
  good month.
- **Burn rate** = current error rate ÷ budget. 1× spends the budget exactly over 30 days. 100× spends
  it in 7 hours. This is the number SRE teams alert on.
- **Latency SLO**: met when the chosen percentile of successful requests is under the threshold.

### Time and dashboards

`patternMultiplier(pattern, minutes)` gives the traffic multiplier at any simulated moment. The clock
starts at 08:00 on day 1. At every tick (4 per second), the site simulates the design with that
moment's traffic (pattern × load multiplier), samples requests, and records a `metricPoint`:
traffic, p50/p99, error rate, burn rate, the busiest utilization, and each component's own signals.
The charts keep the last 240 points, which is an hour at 1 min/s or two and a half days at 1 h/s.

### Alerts

`evaluateAlerts(rules, points, sloLatencyMs)` replays the recorded metrics through each rule, the
way Prometheus does:

- A rule's condition must hold **for** its duration before it fires. Until then it is *pending*,
  which filters out blips. It resolves as soon as the condition stops holding.
- System rules (burn rate, latency at the SLO percentile) have one state. Component rules
  (utilization, queue backlog, down) are evaluated for every component.
- The defaults follow standard SRE advice: **page on symptoms, ticket on causes**. Only error-budget
  burn and SLO latency page someone, because they mean users are hurting now. A hot or dead
  component is a cause: with redundancy, or behind a queue, users may never notice. Fail the
  Mailer in the sample design and you get two tickets and no page.

Tuned rules are saved in this browser.

### Tracing

`generateTrace(design, sim)` follows one request and records a span per component it touches:
start time, duration (including the calls it waited for) and self time (its own work). It uses the
same rules and random waits as the percentile sampler, so traces are concrete examples of the
requests behind the percentiles, and a test checks that they average to the traffic model's
response time.

- A component does its own work, then calls its dependencies one after another.
- Async calls (a queue's consumers, connections labelled `async` or `events`) start a separate
  span that runs on after the response. Their failures never reach the user.
- A component that is down or dropping requests fails its span and every caller waiting on it.
  The remaining calls never happen.

`pickTrace` generates 200 traces and returns an **exemplar**: the median, the p99 or a failing one.
That's how teams go from "p99 is high" on a dashboard to the request that shows why.
`timeBreakdown` splits the user's wait by component.

### Game day

`pickFault(design, slo, seed)` lists every fault that fits the design (`faultCandidates`), measures
what each would do (`faultHarm`: burn rate and latency against the SLO), and picks one at random
among those that would visibly break the SLOs. A fault nobody could see would make a dull drill.
`applyFault` returns the design as the fault leaves it. The site simulates that version, while the
canvas and inspector keep showing the design as you built it, so only the symptoms give it away.

The incident is over at the start of the first 5-minute run of healthy points (`recoveredAt`) after
the system was first seen unhealthy. `budgetUsed` adds up the failed requests in between. Each
sample holds its value until the next, as scraped metrics do.

### Estimation and cost

`estimate(input)` is the classic back-of-the-envelope calculation:
users × requests ÷ 86,400 = average rps, × the peak factor = peak rps. Storage is
writes × size × 365 × years × copies. Bandwidth is reads × response size. The cache holds the
hot share of a day's reads. It uses decimal units (1 KB = 1,000 bytes).

`monthlyCost(design)` uses round, ballpark prices per instance. Only the ratios matter: a
database replica costs about 4× an app server.

### Limits

- Steady load only: no bursts, retries, timeouts or retry storms. Percentiles assume each
  component behaves like a simple M/M/1 queue.
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
| [`src/sre.ts`](src/sre.ts) | Sampled requests (percentiles, error rates), SLOs and error budgets |
| [`src/timeline.ts`](src/timeline.ts) | Traffic patterns, the simulated clock, and the metric points the dashboard plots |
| [`src/alerts.ts`](src/alerts.ts) | Alert rules and their evaluation over time (pending, firing, resolved) |
| [`src/tracing.ts`](src/tracing.ts) | Distributed traces: spans, exemplar picking, where the time went |
| [`src/gameday.ts`](src/gameday.ts) | Game day faults, harm check, recovery detection and incident scoring |
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
