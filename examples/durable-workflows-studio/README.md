# Durable Workflows Studio

A live operations dashboard for Runner's durable workflows: search and filter
recent activity, read health insights and charts, inspect steps, signals,
parent/child trees and loops, then safely operate executions and schedules.
React client, dependency-free Node API, SSE live updates.

```
examples/durable-workflows-studio
├── src/
│   ├── server/      runner wiring, timeline projection, REST + SSE API
│   ├── workflows/   5 demo workflows, signals, visualisation catalog
│   └── shared/      JSON contracts + status metadata (server and web)
├── web/             vite + react client (Linear-style, dark)
└── docs/            engine analysis (ANALYSIS.md)
```

## Quickstart (live runtime)

```bash
cd examples/durable-workflows-studio
npm install
npm run build:all   # server + web client
npm start           # → http://localhost:4317
```

Open that URL in a browser. The server boots a real Runner runtime with an
in-memory durable backend and serves both the JSON API and the web client.

For client iteration:

```bash
npm run dev:server  # API on :4317 (rebuilds first)
npm --prefix web run dev   # web on :5193, proxies /api
```

## Demo mode (no backend)

The client ships an in-memory simulator behind the same API interface, so the
full experience renders without the Runner server. Start the web client:

```bash
npm run dev:web
# → http://localhost:5193/?demo=1
```

Demo executions genuinely progress: a fresh onboarding runs live, an incident
parks on approval, and a portfolio parent fans out regional children with
visible loop iterations. Completed, queued-signal, and failed states are also
seeded. Any `?demo=1` link below works from the web client or live server.

## Tour

- **Overview** — live freshness, exact-ID search, workflow/status filters, KPI
  cards, operational insights, activity/status charts, latest runs and health.
- **Executions** — indexed workflow/status filters and exact-ID lookup across
  history, with cursor loading, a bounded page cache, and virtualized rows.
- **Timeline** — every node with its live state, branch taken, wait
  countdowns, and expandable results. Waiting signals get a one-click send.
- **Tree** — navigate parents and direct children across workflow boundaries.
- **Signals** — delivered, consumed and queued history with payloads.
- **Data** — input, result and precise error step/stack for the execution.
- **Audit** — the persisted durable audit trail (steps, sleeps, signals,
  branches, notes).
- **Schedules** — preview upcoming fires, create/edit cron, interval and
  one-time timers, pause, resume, and delete.
- **Ops** — audited skip-step/edit-state repairs, JSON export, cancel, retry,
  force-fail with a reason, and orphan recovery.

Keyboard: `/` focuses search, `n` starts an execution, `Esc` closes dialogs.

See [Progressive Pagination](docs/PAGINATION.md) for the 100k-result contract,
Redis backfill, scale checks, and the remaining legacy surface limitations.

## Deep links

| View | URL suffix |
| --- | --- |
| Live incident on its approval wait | `?demo=1&select=demo_inc_live` |
| Completed order | `?demo=1&select=demo_ord_completed` |
| Failed chaos run | `?demo=1&select=demo_inc_failed` |
| Fresh onboarding running live | `?demo=1&select=demo_onb_live` |
| Parent with three regional children | `?demo=1&select=demo_portfolio_live` |
| APAC child in a three-iteration loop | `?demo=1&select=demo_rollup_apac` |
| Schedules | `?demo=1&view=schedules` |
| Start dialog | `?demo=1&modal=start` |
| Signal dialog (needs `select=`) | `?demo=1&select=demo_inc_live&modal=signal` |

Drop `demo=1` for the same views against the live runtime.

## Auth (optional admin token)

Set `STUDIO_TOKEN` to lock the studio behind a shared admin token:

```bash
STUDIO_TOKEN=s3cret npm start
```

When configured, every `/api` route except `GET /api/health` requires
`Authorization: Bearer <token>` (the SSE stream accepts `?token=` instead,
since `EventSource` cannot set headers) and answers `401` otherwise. With no
`STUDIO_TOKEN` the studio stays open, as before.

The web client probes the API on boot and shows a login screen on `401`;
the token lives in `sessionStorage` (cleared on logout or tab close) and is
attached to every request. To preview the locked experience without a
Runner server, open `http://localhost:5193/?demo=1&auth=1` after
`npm run dev:web` — the demo token is `admin`.

## Capturing screenshots

```bash
npm run shots   # builds the client, captures docs/shots/*.png in Chrome
```

See [docs/SHOTS.md](docs/SHOTS.md) for the capture catalog. To capture by hand instead,
open `http://localhost:5193/` with any deep link above at 1600×1000 after
`npm run dev:web`.

## API

All JSON under `/api` (see `src/server/api.ts` for exact shapes):

| Method & path | Purpose |
| --- | --- |
| `GET /api/health` | liveness |
| `GET /api/workflows` | catalog with graphs, signals, presets |
| `GET /api/workflows/:key` | one workflow |
| `POST /api/executions` | start `{ workflow, input }` → `{ executionId }` |
| `GET /api/executions?workflowKey&status&limit&offset` | list a bounded page with `hasMore` and `nextOffset` |
| `GET /api/executions/:id` | full detail incl. timeline, tree, signals + audit |
| `GET /api/executions/:id/stream` | SSE detail stream |
| `POST /api/executions/:id/signals` | deliver `{ signal, payload }` |
| `POST /api/executions/:id/cancel` | cooperative cancel |
| `POST /api/executions/:id/retry` | rollback to pending + recover |
| `POST /api/executions/:id/force-fail` | fail with `{ reason }` |
| `POST /api/executions/:id/skip-step` | skip with `{ stepId, reason }` |
| `POST /api/executions/:id/edit-state` | replace `{ stepId, result, reason }` |
| `GET/POST /api/schedules` | list / create timers |
| `POST /api/schedules/preview` | validate cadence + return upcoming fires |
| `PATCH /api/schedules/:id` | edit cadence / input |
| `POST /api/schedules/:id/pause` | pause |
| `POST /api/schedules/:id/resume` | resume |
| `DELETE /api/schedules/:id` | delete |
| `GET /api/stuck` | executions needing attention |
| `POST /api/recover` | resume orphaned executions |

Terminal executions answer `409` to signals/cancel/retry/force-fail instead
of silently ignoring the operation.

## Tests

```bash
npm test      # server (node:test) + web (vitest)
npm run check # build:all + full suite
```

- `src/api.e2e.test.ts` — full lifecycles through the real router:
  order signal path, onboarding timeout branch, incident ack→approve.
- `src/api.ops.test.ts` — chaos failure + retry re-run, cancel, force-fail,
  schedules firing executions, validation and conflict cases.
- `src/timeline.test.ts` — timeline projection incl. marker-derived waits,
  branch pruning, failure pinpointing.
- `src/http.test.ts` — transport through the real listener (bodies, SSE,
  static files) without TCP sockets.
- `src/workflows.test.ts`, `src/shared.test.ts` — catalog and status
  contracts.
- `web/src/demo.test.ts` — the demo simulator lifecycle.
- `web/src/render.test.tsx` — every view renders with fixture data.

## Workflows

| Key | Flow |
| --- | --- |
| `processOrder` | validate → charge → sleep → await `paymentConfirmed` → ship |
| `userOnboarding` | create → email → await `emailVerified` (timeout) → switch → welcome |
| `incidentResponse` | triage → page → await ack → switch → diagnose → await approval → switch → remediate → verify / escalate → close |
| `portfolioReconciliation` | plan → start 3 regional children → join each → publish rollup |
| `regionalRollup` | three inspectable batch-loop iterations; usually runs as a child |

Timeouts and the order sleep accept input overrides (`ackTimeoutMs`,
`approvalTimeoutMs`, `verificationTimeoutMs`, `processingDelayMs`) so demos
and tests never wait on wall-clock defaults. `chaos: true` on the incident
input explodes the diagnose step to exercise failure tooling.

Engine analysis and the framework gaps resolved while building this live in
[docs/ANALYSIS.md](docs/ANALYSIS.md).
