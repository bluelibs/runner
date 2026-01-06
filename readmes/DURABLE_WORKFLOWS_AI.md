# Durable Workflows (v2) — Token-Friendly

Durable workflows are **Runner tasks with replay-safe checkpoints** (Node-only: `@bluelibs/runner/node`).

They’re designed for flows that span time (minutes → days): approvals, payments, onboarding, shipping.

## The mental model

- A workflow does not “resume the instruction pointer”.
- On every wake-up (sleep/signal/retry/recover), it **re-runs from the top** and fast-forwards using stored results:
  - `ctx.step("id", fn)` runs once, persists result, returns cached on replay.
  - `ctx.sleep(...)` and `ctx.waitForSignal(...)` persist durable checkpoints.

Rule: side effects belong inside `ctx.step(...)`.

## The happy path

1) **Register a durable resource** (store + queue + event bus).
2) **Write a durable task**:
   - stable `ctx.step("...")` ids
   - explicit `{ stepId }` for `sleep/emit/waitForSignal` in production
3) **Start the workflow**:
   - `executionId = await service.startExecution(task, input)`
   - persist `executionId` in your domain row (eg. `orders.execution_id`)
   - or `await service.execute(task, input)` to start + wait in one call
   - or `await service.executeStrict(task, input)` for stricter result typing
4) **Interact later via signals**:
   - look up `executionId`
   - `await service.signal(executionId, SignalDef, payload)`

Signals buffer if no waiter exists yet; the next `waitForSignal(...)` consumes the payload.

`waitForSignal()` return shapes:

- `await ctx.waitForSignal(Signal)` → `payload` (throws on timeout)
- `await ctx.waitForSignal(Signal, { timeoutMs })` → `{ kind: "signal", payload } | { kind: "timeout" }`

## Scheduling

- One-time: `service.schedule(task, input, { at } | { delay })`
- Recurring: `service.ensureSchedule(task, input, { id, cron } | { id, interval })`
- Manage: `pauseSchedule/resumeSchedule/getSchedule/listSchedules/updateSchedule/removeSchedule`

## Recovery

- `await service.recover()` on startup kicks incomplete executions.
- Timers (sleeps, signal timeouts, schedules) require polling enabled in at least one process.

## Inspecting an execution

- `store.getExecution(executionId)` → status (running/sleeping/completed/failed/etc)
- When supported:
  - `store.listStepResults(executionId)` → completed steps
  - `store.listAuditEntries(executionId)` → timeline (step_completed, signal_waiting, signal_delivered, sleeps, status changes)
- `new DurableOperator(store).getExecutionDetail(executionId)` returns `{ execution, steps, audit }`.

There’s also a dashboard middleware: `createDashboardMiddleware(service, new DurableOperator(store))` (protect behind auth).

“Internal steps” are recorded steps created by durable primitives (`sleep/waitForSignal/emit` and some bookkeeping). They typically use reserved step id prefixes like `__...` or `rollback:...`.

Audit can be enabled via `audit: { enabled: true }`; inside workflows you can add replay-safe notes via `ctx.note("msg", meta)`. In Runner integration, audit entries are also emitted via `durableEvents.*`.

Runner integration detail: durable events emission does not depend on `audit.enabled` (it controls store persistence); events are emitted as long as an audit emitter is configured (the `durableResource` wires one by default).

Import and subscribe using event definitions (not strings): `import { durableEvents } from "@bluelibs/runner/node"` and `.on(durableEvents.audit.appended)` (or a specific durable event).

## Compensation / rollback

- `ctx.step("id").up(...).down(...)` registers compensations.
- `await ctx.rollback()` runs compensations in reverse order.

## Versioning (don’t get burned)

- Step ids are part of the durable contract: don’t rename/reorder casually.
- For breaking behavior changes, ship a **new workflow task id** (eg. `...v2`) and route new starts to it while v1 drains.
- A “dispatcher/alias” task is great for *new starts*, but in-flight stability requires the version choice to be stable (don’t silently change behavior under the same durable task id).

## Operational notes

- `ctx.emit(...)` is best-effort (notifications), not guaranteed delivery.
- Queue mode is at-least-once; correctness comes from the store + step memoization.
