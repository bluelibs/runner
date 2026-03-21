# Durable Workflows (v2) — Token-Friendly

← [Back to main README](../README.md) | [Full documentation](./DURABLE_WORKFLOWS.md)

---

Durable workflows are **Runner tasks with replay-safe checkpoints** (Node-only: `@bluelibs/runner/node`).

They're designed for flows that span time (minutes → days): approvals, payments, onboarding, shipping.

## Built-in resilience

The runtime already bakes in a lot of the "please don't wake me up at 3am" behavior:

- replay-safe steps prevent duplicate side-effects on retry/replay
- sleeps and signal waits survive restarts because their state is persisted
- startup recovery can re-drive incomplete executions
- execution locking and persisted state make horizontal workers safer
- signals can arrive early and wait in a FIFO queue until consumed
- idempotent starts are transactional
- `wait()` / `startAndWait()` still have polling fallbacks if notifications are missed

## The mental model

- A workflow does not "resume the instruction pointer".
- On every wake-up (sleep/signal/retry/recover), it **re-runs from the top** and fast-forwards using stored results:
  - `durableContext.step("id", fn)` runs once, persists result, returns cached on replay.
  - `durableContext.sleep(...)` and `durableContext.waitForSignal(...)` persist durable checkpoints.

Rule: side effects belong inside `durableContext.step(...)`.

## The happy path

1. **Register a durable resource** (store + queue + event bus).
2. **Write a durable task**:
   - stable `durableContext.step("...")` ids
   - explicit `{ stepId }` for `sleep` / `waitForSignal` in production
3. **Start the workflow**:
   - `executionId = await service.start(taskOrTaskId, input)`
   - persist `executionId` in your domain row (eg. `orders.execution_id`)
   - or `await service.startAndWait(taskOrTaskId, input)` to start + wait in one call
4. **Interact later via signals**:
   - look up `executionId`
   - `await service.signal(executionId, SignalDef, payload)`

For user-facing status pages, you can read the durable execution on-demand from the durable store using `executionId` (no need to mirror into Postgres): `store.getExecution(executionId)` (or `new DurableOperator(store).getExecutionDetail(executionId)` when supported).

Signals retain execution-level history for live workflows. Each `executionId + signalId`
keeps a FIFO queue of unmatched signals for automatic `waitForSignal(...)` consumption,
while all arrivals remain available in signal history.

`taskOrTaskId` can be:

- an `ITask` (recommended, keeps full input/result type-safety)
- a task id `string` (resolved via runtime registry; fail-fast if not found)

`taskOrTaskId` is the built task object (`.build()`) or its id string, not the injected dependency callable from `.dependencies({...})`.

`start()` vs `startAndWait()`:

- `start(taskOrTaskId, input)` returns `executionId` immediately.
- `startAndWait(taskOrTaskId, input)` starts, waits, and returns `{ durable: { executionId }, data }`.
  `timeout` still means workflow runtime timeout; use `completionTimeout` to bound the caller wait.
  `startAndWait(..., { timeout })` alone does not shorten how long the caller waits.

## Tagging workflows (required for discovery)

Durable workflows are regular Runner tasks, but **must be tagged with `tags.durableWorkflow`** to make them discoverable at runtime. Always add this tag to your workflow tasks:

```ts
import { r } from "@bluelibs/runner";
import { resources, tags } from "@bluelibs/runner/node";

const durable = resources.memoryWorkflow.fork("app-durable");

const onboarding = r
  .task("onboarding")
  .dependencies({ durable })
  .tags([
    tags.durableWorkflow.with({
      category: "users",
      defaults: { invitedBy: "system" },
    }),
  ])
  .run(async (_input, { durable }) => {
    const durableContext = durable.use();
    await durableContext.step("create-user", async () => ({ ok: true }));
    return { ok: true };
  })
  .build();

// Later, after run(...):
// const durableRuntime = runtime.getResourceValue(durable);
// const workflows = durableRuntime.getWorkflows();
```

`tags.durableWorkflow` is **required for workflow discovery** — workflows without this tag
will not be discoverable via `getWorkflows()`. Execution APIs such as `start()`,
`startAndWait()`, `schedule()`, and `ensureSchedule()` do not require the tag as long as
the task is otherwise registered. Register `resources.durable` once in the app so the
durable tag definition and durable events are available at runtime.

`tags.durableWorkflow` is discovery metadata, and can also carry optional `defaults` for `describe(...)`.
The unified response envelope is produced by `startAndWait(...)`: `{ durable: { executionId }, data }`.
`defaults` are applied only by `describe(task)` when no explicit describe input is passed.
It can also declare optional workflow-local `signals` to constrain which signal ids the
workflow may wait for or receive.

### Starting workflows from dependencies (HTTP route)

Tagged tasks are discovery metadata only. Start workflows explicitly via `durable.start(...)` (or `durable.startAndWait(...)` when you want to wait for completion):

```ts
import express from "express";
import { r, run } from "@bluelibs/runner";
import { resources, tags } from "@bluelibs/runner/node";

const durable = resources.memoryWorkflow.fork("app-durable");

const approveOrder = r
  .task("approve-order")
  .dependencies({ durable })
  .tags([tags.durableWorkflow.with({ category: "orders" })])
  .run(async (input: { orderId: string }, { durable }) => {
    const durableContext = durable.use();
    await durableContext.step("approve", async () => ({ approved: true }));
    return { orderId: input.orderId, status: "approved" as const };
  })
  .build();

const api = r
  .resource("api")
  .register([resources.durable, durable.with({ worker: false }), approveOrder])
  .dependencies({ durable, approveOrder })
  .init(async (_cfg, { durable, approveOrder }) => {
    const app = express();
    app.use(express.json());

    app.post("/orders/:id/approve", async (req, res) => {
      const executionId = await durable.start(approveOrder, {
        orderId: req.params.id,
      });
      res.status(202).json({ executionId });
    });

    app.listen(3000);
  })
  .build();

await run(api);
```

Recommended wiring (config-only resources):

```ts
import { resources } from "@bluelibs/runner/node";

// dev/tests
const durable = resources.memoryWorkflow.fork("app-durable").with({
  worker: true,
});

// production (Redis + optional RabbitMQ queue)
const durableProd = resources.redisWorkflow.fork("app-durable").with({
  redis: { url: process.env.REDIS_URL! },
  queue: { url: process.env.RABBITMQ_URL! },
  worker: true,
});
```

Production mental model:

- **Redis store** is the source of truth: execution rows, step results, timers, schedules, signal history/queues, waiter state, and optional audit.
- **RabbitMQ** distributes `execute` / `resume` work to workers. Queue messages carry `executionId` and delivery metadata, not authoritative workflow state.
- **Redis pub/sub** is the fast notification path for `wait()` / `startAndWait()` and related wakeups.

Why this matters:

- if a worker dies, the next worker reloads from Redis and replays
- if RabbitMQ duplicates a message, replay stays safe because step results are already persisted
- if a queue publish or pub/sub notification is missed, Redis-backed polling/recovery can still rediscover incomplete executions

Rule of thumb: RabbitMQ makes it fast; Redis makes it correct.

`waitForSignal()` return shapes:

- `await durableContext.waitForSignal(Signal)` → `payload` (throws on timeout)
- `await durableContext.waitForSignal(Signal, { timeoutMs })` → `{ kind: "signal", payload } | { kind: "timeout" }`

## Scheduling

- One-time: `service.schedule(taskOrTaskId, input, { at } | { delay })`
- Recurring: `service.ensureSchedule(taskOrTaskId, input, { id, cron } | { id, interval })`
- Manage: `pauseSchedule/resumeSchedule/getSchedule/listSchedules/updateSchedule/removeSchedule`

## Recovery

- `await service.recover()` on startup kicks incomplete executions.
- Timers (sleeps, signal timeouts, schedules) require polling enabled in at least one process.

## Inspecting an execution

- `createDashboardMiddleware` is now part of `@bluelibs/runner-durable-dashboard` (not core).
- `store.getExecution(executionId)` → status (running/sleeping/completed/failed/etc)
- When supported:
  - `store.listStepResults(executionId)` → completed steps
  - `store.listAuditEntries(executionId)` → timeline (step_completed, signal_waiting, signal_delivered, sleeps, status changes)
- `new DurableOperator(store).getExecutionDetail(executionId)` returns `{ execution, steps, audit }`.

"Internal steps" are recorded steps created by durable primitives (`sleep/waitForSignal/emit` and some bookkeeping). They typically use reserved step id prefixes like `__...` or `rollback:...`.

Audit can be enabled via `audit: { enabled: true }`; inside workflows you can add replay-safe notes via `durableContext.note("msg", meta)`. In Runner integration, audit entries are also emitted via `durableEvents.*`.

Runner integration detail: durable events emission does not depend on `audit.enabled` (it controls store persistence); events are emitted as long as an audit emitter is configured (the built-in durable workflow resources wire one by default).

Import and subscribe using event definitions (not strings): `import { durableEvents } from "@bluelibs/runner/node"` and `.on(durableEvents.audit.appended)` (or a specific durable event).

## Compensation / rollback

- `durableContext.step("id").up(...).down(...)` registers compensations.
- `await durableContext.rollback()` runs compensations in reverse order.

## Branching with durableContext.switch()

`durableContext.switch()` is a replay-safe branching primitive. It evaluates matchers against a value, persists which branch was taken, and on replay skips the matchers entirely.

```ts
const result = await durableContext.switch(
  "route-order",
  order.status,
  [
    {
      id: "approve",
      match: (s) => s === "paid",
      run: async (s) => {
        /* ... */ return "approved";
      },
    },
    {
      id: "reject",
      match: (s) => s === "declined",
      run: async () => "rejected",
    },
  ],
  { id: "manual-review", run: async () => "needs-review" },
); // optional default
```

- First arg is the step id (must be unique, like `durableContext.step`).
- Matchers evaluate in order; first match wins.
- The matched branch `id` + result are persisted; on replay the cached result is returned immediately.
- Throws if no branch matches and no default is provided.
- Audit emits a `switch_evaluated` entry with `branchId` and `durationMs`.

## Describing a flow (static shape export)

Use `durable.describe(...)` to export the structure of a workflow in recording mode. Useful for documentation, visualization, and tooling.

**Easiest: pass the task directly** — no refactoring needed:

```ts
// Get your durable dependency from runtime, then:
const durableRuntime = runtime.getResourceValue(durable);
const shape = await durableRuntime.describe(myTask);
// shape.nodes = [{ kind: "step", stepId: "validate", ... }, ...]

// TInput is inferred from the task, or can be specified explicitly:
const shape2 = await durableRuntime.describe<{ orderId: string }>(myTask, {
  orderId: "123",
});
```

The recorder runs the task body in a describe-safe mode, shims `durable.use()` inside the task's `run`, snapshots non-durable dependencies with `structuredClone(...)`, and records every `durableContext.*` operation.

If the task uses `tags.durableWorkflow.with({ defaults: {...} })`, `describe(task)` uses those defaults.
`describe(task, input)` always overrides tag defaults.

Notes:

- The recorder captures each `durableContext.*` call as a `FlowNode`; durable step bodies are never executed.
- The task body control flow still runs. Keep describe-safe logic around durable primitives, and avoid arbitrary side effects in the task body itself.
- Non-durable dependencies must be structured-cloneable or `describe()` fails fast.
- Supported node kinds: `step`, `sleep`, `waitForSignal`, `emit`, `switch`, `note`.
- `DurableFlowShape` and all `FlowNode` types are exported for type-safe consumption.
- Conditional logic should be modeled with `durableContext.switch()` (not JS `if/else`) for the shape to capture it.

## Versioning (don't get burned)

- Step ids are part of the durable contract: don't rename/reorder casually.
- For breaking behavior changes, ship a **new workflow task id** (eg. `...v2`) and route new starts to it while v1 drains.
- A "dispatcher/alias" task is great for _new starts_, but in-flight stability requires the version choice to be stable (don't silently change behavior under the same durable task id).

## Operational notes

- `durableContext.emit(...)` is best-effort (notifications), not guaranteed delivery.
- Queue mode is at-least-once; correctness comes from the store + step memoization.
