# Durable Workflows (v2)

Durable workflows let you write **long-running business flows** (minutes → days) as normal Runner tasks, while getting:

- **durability** across crashes/deploys,
- **replay-safe side effects** (do it once, not twice),
- **external interaction** via signals (webhooks, user actions),
- **inspectability** (status, steps, audit trail) for ops and product.

If you already liked the “keep app code local, move execution by config” story from tunnels, this is the same philosophy applied to **time**:

- Tunnels move _where_ code runs.
- Durable workflows handle _when_ code continues.

---

## The story (the mental model)

### The core trick: durability via replay

Durable workflows don’t “pause the CPU and resume the instruction pointer”.

Instead, whenever an execution wakes up (after a sleep, signal, retry, or recovery), Runner **re-runs the workflow function from the top** and “fast-forwards” through what already happened:

- `ctx.step("A", fn)` asks the store: “Do I already have the result for step `A`?”
  - If yes → return it immediately (replay).
  - If no → run `fn`, persist the result, return it.
- `ctx.sleep(...)` and `ctx.waitForSignal(...)` create durable checkpoints that can suspend the attempt and resume later.

This gives you a clean rule of thumb:

> If something must happen **exactly once**, put it in `ctx.step(...)` (or an internal durable primitive that persists state).

---

## The happy path (end-to-end walkthrough)

This section is intentionally a story you can follow, not a reference dump.

### Step 0 — Decide what’s durable

Durability is for workflows that:

- wait on humans or third parties (approval, payment, KYC),
- must survive deploys/crashes,
- must not duplicate side effects on retries (charge twice, email twice).

Durable workflows are **Node-only** and exported from `@bluelibs/runner/node`.

---

### Step 1 — Create a durable resource (the infrastructure handle)

You register a single durable resource in your runtime and inject it into durable tasks.

For dev/tests you typically use in-memory backends; for production you usually use:

- Redis for state,
- RabbitMQ for work distribution,
- Redis pub/sub for cross-worker notifications.

Example (dev/test shape):

```ts
import { r } from "@bluelibs/runner";
import {
  durableResource,
  MemoryStore,
  MemoryQueue,
  MemoryEventBus,
} from "@bluelibs/runner/node";

export const durable = durableResource.fork("app.durable").with({
  store: new MemoryStore(),
  queue: new MemoryQueue(),
  eventBus: new MemoryEventBus(),
  worker: true, // single-process dev/tests
});

export const app = r.resource("app").register([durable]).build();
```

Production wiring normally looks like:

```ts
import {
  durableResource,
  RedisStore,
  RabbitMQQueue,
  RedisEventBus,
} from "@bluelibs/runner/node";

const durable = durableResource.fork("app.durable").with({
  store: new RedisStore({ redis: process.env.REDIS_URL }),
  queue: new RabbitMQQueue({ url: process.env.RABBITMQ_URL }),
  eventBus: new RedisEventBus({ redis: process.env.REDIS_URL }),
  worker: true,
});
```

Multi-process note:

- API nodes usually do `worker: false` and `polling: { enabled: false }`.
- Worker nodes run `worker: true` (and typically keep polling enabled).

---

### Step 2 — Define the workflow (as a normal Runner task)

Think of a workflow as “a task with durable checkpoints”.

```ts
import { event, r } from "@bluelibs/runner";

// Signal definitions are events (typed payloads).
export const OrderApproved = event<{ approvedBy: string }>({
  id: "app.signals.orderApproved",
});

export const processOrder_v1 = r
  .task("app.workflows.processOrder.v1")
  .dependencies({ durable })
  .run(async (input: { orderId: string }, { durable }) => {
    const ctx = durable.use();

    const order = await ctx.step("load-order", async () => {
      // load from DB, validate, etc.
      return { id: input.orderId };
    });

    await ctx.step("create-payment-intent", async () => {
      // call Stripe/Adyen/etc
      return { ok: true };
    });

    // Durable timers survive deploys/crashes; use a stable stepId for replay safety.
    await ctx.sleep(5_000, { stepId: "sleep-after-payment-intent" });

    const approval = await ctx.waitForSignal(OrderApproved, {
      stepId: "wait-order-approval",
      // or { timeoutMs } if you want timeout as a return union
    });

    await ctx.step("ship", async () => {
      // perform side effect exactly once
      return { shipped: true, approvedBy: approval.approvedBy };
    });

    return { ok: true, orderId: order.id };
  })
  .build();
```

Key rules:

- Side effects go inside `ctx.step(...)` (or a durable primitive).
- Use **stable step ids** (`"load-order"`, `"ship"`, etc.).
- For `sleep/emit/waitForSignal`, pass explicit `{ stepId }` in production paths.

---

### Step 3 — Start the workflow (and store the execution id in your domain)

Durable workflows are addressed by `executionId`. That id is your “handle” for continuing, inspecting, and signaling.

Typical domain model:

- You have `orders` (or `payments`, `onboarding`) table.
- You start the workflow and persist `orders.execution_id = <executionId>`.

```ts
const service = await runtime.getResourceValue(durable);

const executionId = await service.startExecution(processOrder_v1, {
  orderId: "order_123",
});

// store executionId on your Order row
```

`startExecution/execute/wait` accept common options like `timeout` and `waitPollIntervalMs` (and `priority` when a queue is configured).

If you want “start and wait”:

```ts
const result = await service.wait(executionId);
```

If you want “execute and return the result” (start + wait as a single call):

```ts
const result = await service.execute(processOrder_v1, { orderId: "order_123" });
```

If you want stricter type-safety (reject tasks that can resolve to `undefined`):

```ts
const result = await service.executeStrict(processOrder_v1, { orderId: "order_123" });
```

### Errors, retries, and timeouts (what callers should expect)

- `wait(...)` / `execute(...)` reject when the execution ends in a failure state (commonly as a `DurableExecutionError`).
- Retries are controlled by execution-level and step-level policies (max attempts / step retries).
- Timeouts are control-flow boundaries, not cancellation: timed-out async work may still finish later and perform side effects.

---

### Step 4 — Continue the workflow from the outside (signals)

You don’t “call into” a running workflow. You **signal** it.

When something happens (webhook, user button click), you:

1. look up `executionId` from your domain row,
2. call `service.signal(executionId, SignalDef, payload)`.

```ts
// Example: user/admin approves the order
await service.signal(executionId, OrderApproved, {
  approvedBy: "ada@company.com",
});
```

Signals are buffered:

- If the workflow is already waiting → the signal completes that waiter and resumes execution.
- If the workflow isn’t waiting yet → the signal payload is persisted and the next `waitForSignal(...)` consumes it immediately.

Operational implication:

> “Continuing the flow” is usually “send the next signal”.

### Waiting with a timeout (and stable step ids)

`waitForSignal()` has two return shapes:

- `await ctx.waitForSignal(Signal)` → returns `payload` (throws on timeout)
- `await ctx.waitForSignal(Signal, { timeoutMs })` → returns `{ kind: "signal", payload } | { kind: "timeout" }`

`stepId` is for determinism only; it does not change the return type:

```ts
const outcome = await ctx.waitForSignal(OrderApproved, {
  stepId: "wait-order-approval",
  timeoutMs: 86_400_000,
});

if (outcome.kind === "timeout") {
  return { ok: false, reason: "approval-timed-out" as const };
}
```

---

## Finding and inspecting an existing workflow

In real systems you’ll have `execution_id="..."` persisted and you’ll need to answer:

- Is it running / sleeping / completed / failed?
- What steps already happened?
- What is it currently waiting for?
- Can we intervene (skip a step, retry rollback, force-fail)?

### The minimum: `getExecution(executionId)`

Your store supports:

- `getExecution(id)` → current status + metadata

So you can do:

```ts
const exec = await store.getExecution(executionId);
// exec?.status is the high-level truth (running/sleeping/completed/failed/etc)
```

### The useful view: steps + audit trail (timeline)

When supported by the store:

- `listStepResults(executionId)` → what steps (and internal steps) have results
- `listAuditEntries(executionId)` → timeline events like:
  - `step_completed`
  - `signal_waiting` / `signal_delivered`
  - `sleep_scheduled` / `sleep_completed`
  - `execution_status_changed`

#### What is an “internal step”?

Durable has two kinds of recorded steps:

- **User steps**: the ones you define explicitly via `ctx.step("my-id", ...)`.
- **Internal steps**: steps created by the durable engine to make primitives replay-safe (eg. `ctx.sleep(...)`, `ctx.waitForSignal(...)`, `ctx.emit(...)`, rollback bookkeeping). Internal step ids typically use reserved prefixes like `__...` or `rollback:...`.

When you build “workflow progress” UIs, you usually want to show user steps and hide internal ones. For observability/ops, internal steps are often useful (they show timers, waits, etc.).

This is enough to infer “current step” as:

- the latest `signal_waiting` entry (if sleeping on a signal),
- or the latest `sleep_scheduled` (if sleeping on a timer),
- or “running” (if actively executing),
- or “completed/failed/compensation_failed”.

### The operator: a single helper to fetch details + intervene

Runner ships `DurableOperator` as a small admin/ops helper around the store:

- list executions (when the store supports it)
- get execution detail (execution + steps + audit)
- optional operator actions (when the store supports them): skip step, retry rollback, force fail, patch step state

```ts
import { DurableOperator } from "@bluelibs/runner/node";

const operator = new DurableOperator(store);

const detail = await operator.getExecutionDetail(executionId);
// detail.execution
// detail.steps
// detail.audit
```

### The dashboard UI

If you want a UI for humans to inspect and intervene, the durable dashboard middleware serves:

- `/api/*` endpoints
- a bundled UI

```ts
import {
  createDashboardMiddleware,
  DurableOperator,
} from "@bluelibs/runner/node";

app.use(
  "/durable-dashboard",
  createDashboardMiddleware(service, new DurableOperator(store)),
);
```

Treat this like an admin control plane:

- protect behind auth,
- do not expose publicly.

---

## Scheduling (one-time + recurring)

Scheduling is the “don’t keep an execution alive forever” alternative to infinite loops.

### One-time scheduling

```ts
await service.schedule(processOrder_v1, { orderId: "order_123" }, { delay: 60_000 });
await service.schedule(processOrder_v1, { orderId: "order_123" }, { at: new Date(Date.now() + 60_000) });
```

### Recurring schedules (recommended for boot-time setup)

Use `ensureSchedule()` with a stable id so it’s safe to call on every boot (and concurrently across processes).

```ts
await service.ensureSchedule(processOrder_v1, { orderId: "order_123" }, { id: "orders.hourly", cron: "0 * * * *" });
await service.ensureSchedule(processOrder_v1, { orderId: "order_123" }, { id: "orders.poll", interval: 30_000 });
```

### Managing schedules

```ts
await service.pauseSchedule("orders.hourly");
await service.resumeSchedule("orders.hourly");

const schedule = await service.getSchedule("orders.hourly");
const all = await service.listSchedules();

await service.updateSchedule("orders.hourly", { cron: "0 */2 * * *" });
await service.removeSchedule("orders.hourly");
```

---

## Recovery (what to do on startup)

Durable state lives in the store, but work still needs to be re-kicked after crashes/deploys.

Call:

- `await service.recover()` on startup to kick incomplete executions.
- Keep polling enabled in at least one process if you rely on timers (sleeps, signal timeouts, schedules).

In Runner integration (`durableResource`), the service lifecycle is owned by the resource; disposing the Runner runtime disposes the durable service as well.

---

## Audit, notes, and events (how you know “where it is”)

If you want to answer “what step is it on?” reliably, use audit +/or step results:

- **execution status** comes from `getExecution(executionId)`.
- **timeline** comes from audit entries (signal waits/deliveries, sleeps, steps).

### Enable audit trail

```ts
const durableRegistration = durable.with({
  store,
  queue,
  eventBus,
  audit: { enabled: true },
});
```

Important distinction:

- `audit.enabled: true` means “persist audit entries to the durable store” (when the store supports `appendAuditEntry`/`listAuditEntries`).
- **Durable events emission is independent**: when you use the Runner integration (`durableResource`), Runner wires an audit emitter automatically, so durable events are emitted even when `audit.enabled` is `false`/unset. (Persistence stays off unless enabled.)
- If you instantiate `DurableService` directly, events are emitted only if you pass `audit.emitter`.

### Add replay-safe notes from inside the workflow

```ts
await ctx.note("created-payment-intent", { paymentIntentId: "pi_123" });
```

### Subscribe to Runner events for logging/mirroring

In Runner integration, durable emits lifecycle/audit events via `durableEvents.*` (eg. to mirror to Postgres/S3).

#### Durable events (how to subscribe, and what each one means)

Durable emits **Runner event definitions** (not strings). Import them and subscribe explicitly (they’re system events and excluded from `on("*")` global hooks by default).

```ts
import { r } from "@bluelibs/runner";
import { durableEvents } from "@bluelibs/runner/node";

export const logDurable = r
  .hook("app.hooks.logDurable")
  .on(durableEvents.audit.appended)
  .run(async (ev) => {
    // ev.data.entry is a DurableAuditEntry union
    console.log("durable.audit", ev.data.entry.kind, ev.data.entry.executionId);
  })
  .build();
```

What each event is for:

- `durableEvents.audit.appended` — a “catch-all” stream of everything durable records (status changes, step completions, signal waits, sleeps, notes). Payload: `{ entry }`. Use this for mirroring/logging pipelines because you don’t need to subscribe to multiple events.
- `durableEvents.execution.statusChanged` — fires when an execution transitions status (eg. `pending → running → sleeping → completed/failed`). Payload is the status-change entry (includes `executionId`, `from`, `to`, optional `reason`).
- `durableEvents.step.completed` — fires when a durable step completes (including durable internal steps). Payload includes `executionId`, `stepId`, `durationMs`, and `isInternal`. Use this for performance telemetry, “stuck step” detection, and progress UIs.
- `durableEvents.sleep.scheduled` — fires when a workflow schedules a durable timer (`ctx.sleep(...)`). Payload includes `executionId`, `stepId`, `timerId`, and `fireAt`. Useful for “next wakeup at” displays.
- `durableEvents.sleep.completed` — fires when a sleep timer fires and the sleep checkpoint completes. Use it for “workflow resumed” observability.
- `durableEvents.signal.waiting` — fires when a workflow begins waiting on a signal (`ctx.waitForSignal(...)`). Payload includes `executionId`, `signalId`, `stepId`, and optional timeout info. This is the cleanest way to know “what user action is required next”.
- `durableEvents.signal.delivered` — fires when a signal is delivered to a waiting execution (and the waiter is completed). Useful for auditing “who/what advanced the workflow”.
- `durableEvents.signal.timedOut` — fires when a signal wait times out (if you used the timeout variant). Useful for escalations and “auto-expire” flows.
- `durableEvents.emit.published` — fires when `ctx.emit(...)` publishes to the durable event bus (replay-safe). Treat this as a notification trail; it does not guarantee external delivery.
- `durableEvents.note.created` — fires when `ctx.note(...)` records a replay-safe note. Useful for product/ops annotations.

Notes:

- By default, Runner emits these with source `"durable.audit"`.
- If you only care about “public” steps, filter out `isInternal: true` on `durableEvents.step.completed`.

---

## Compensation / rollback (the “saga” pattern, explicitly)

Durable supports explicit compensation via:

- `ctx.step("id").up(fn).down(compensate)`
- `await ctx.rollback()` to execute compensations in reverse order

This keeps business logic explicit and replay-safe.

Operational note: if rollback fails, the execution can end up `compensation_failed` and needs manual intervention (eg. `DurableOperator.retryRollback(executionId)` after fixing the underlying issue).

---

## Testing utilities (fast, deterministic tests)

Runner exports a small helper to set up durable backends for tests:

```ts
import { createDurableTestSetup } from "@bluelibs/runner/node";

const { durable, durableRegistration } = createDurableTestSetup({
  worker: true,
  pollingIntervalMs: 5,
});
```

You then register `durableRegistration` in a test runtime and run durable tasks normally.

---

## Versioning workflows safely

Durable workflows have a “schema-like” constraint:

> In-flight executions will replay on whatever code you deploy next.

So you need explicit versioning discipline.

### Rule 1 — Step ids are part of the durable contract

- Renaming `ctx.step("charge", ...)` changes replay behavior for in-flight executions.
- Reordering `sleep/emit/waitForSignal` without explicit `{ stepId }` can shift internal ids and break replay.

Production posture:

- Use explicit ids for all `ctx.step("...")`.
- Use explicit `{ stepId }` for `sleep/emit/waitForSignal`.
- Consider setting `determinism.implicitInternalStepIds` to `"warn"` or `"error"`.
- Avoid step ids that start with `__` or `rollback:` (reserved for durable internals).

### Rule 2 — Breaking behavior changes get a new task id

When you need a breaking change:

- keep v1’s task id and semantics stable,
- create a new workflow task id: `app.workflows.processOrder.v2`,
- route new starts to v2,
- let v1 drain (or actively migrate if needed).

This keeps replay predictable: a v1 execution continues to run v1 logic.

### Rule 3 — Prefer an explicit “dispatcher” for new starts (alias id)

You often want a stable public entrypoint:

- `app.workflows.processOrder` is the “public” id
- it starts the latest version internally

Pattern:

- `processOrder_v2` is the real workflow task
- `processOrder` is a thin starter that routes _new_ executions to v2

Important nuance:

- The dispatcher is safe for _new starts_.
- For _in-flight executions_, version choice must be stable. In general, the cleanest solution is: **don’t reuse the same durable task id for two different behaviors**.

If you must reuse an alias id and still need in-flight stability, persist the chosen version (eg. on the domain row) and ensure replays keep the same choice.

---

## Signals as the primary interaction mechanism

If you store `executionId` on your `orders` row, your system becomes simple:

- Start once → store execution id.
- Every user action / webhook → look up execution id → `signal(...)`.

This is the durable equivalent of:

- HTTP request → route to controller

but over time:

- “event happens” → route to workflow via `executionId`.

Signals are typed (they use Runner event definitions), and `waitForSignal()` gives you a single in-workflow “await external input” primitive.

---

## Gotchas (the ones that bite in production)

### 1) Infinite loops create replay debt

Avoid `while (true)` patterns that add an unbounded number of checkpoints. Every resume must replay through prior durable operations.

Prefer:

- `durable.schedule(...)` / cron / interval schedules for recurring work
- bounded executions that complete and re-schedule the next run

### 2) Timeouts are not cancellation

If an async operation times out, it may still complete later and perform side effects.

Design heavy operations to be:

- idempotent,
- checkable (can we detect “already done”?),
- optionally cooperative-cancellable at the application layer.

### 3) Signals can outpace consumption

Signals buffer when no waiter is active. If producers keep sending without corresponding waits, you can hit a safety limit (store scan limit per signal id).

Use backpressure outside the workflow if producers can be unbounded.

### 4) `emit()` is best-effort (notifications), not a delivery guarantee

Use `ctx.emit(...)` for “tell the world” notifications, not as the only source of truth for integration.

For exactly-once integration, use idempotent external APIs + `ctx.step(...)` and persist what you need.

### 5) Dependency injection doesn’t make side effects replay-safe

Anything outside `ctx.step(...)` may run multiple times on retries/replays.

### 6) Queue delivery is at-least-once

If a queue is configured, messages can be delivered more than once. Correctness comes from storing step results in the store, not from “exactly once queue delivery”.

---

## Configuration knobs (common)

When registering `durableResource.with({ ... })`, the most common knobs are:

- `execution: { maxAttempts, timeout, kickoffFailsafeDelayMs }` (queue-mode failsafe helps prevent “stuck pending” during broker outages)
- `polling: { enabled, interval, claimTtlMs }` (timers: sleeps, signal timeouts, schedules)
- `workerId` (distributed timer coordination)
- `audit: { enabled, emitter }` (timeline + external mirroring; emissions must not affect correctness)
- `determinism: { implicitInternalStepIds: "allow" | "warn" | "error" }`
- Direct `DurableService` usage: provide `taskResolver` (or pre-register `tasks`/`schedules`) so `recover()` can resolve workflow task ids.

---

## TODO (review checklist)

- Confirm naming conventions: `app.workflows.*` vs `app.tasks.*` for durable tasks.
- Decide if we want to recommend `executeStrict(...)` over `startExecution + wait()` in “simple request/response” cases.
- Add a focused “Orders table” mini-example (schema + two endpoints: start, approve).
- Decide where to document `determinism.implicitInternalStepIds` as “production default”.
- Add a minimal test-runtime example that registers `durableRegistration` and runs a durable task.
