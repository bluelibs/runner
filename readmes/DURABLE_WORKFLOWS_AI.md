# Durable Workflows (v2) — Token-Friendly

← [Back to main README](../README.md) | [Full documentation](./DURABLE_WORKFLOWS.md)

---

Durable workflows are **Runner tasks with replay-safe checkpoints** (Node-only: `@bluelibs/runner/node`).

They're designed for flows that span time (minutes → days): approvals, payments, onboarding, shipping.

## The mental model

- A workflow does not "resume the instruction pointer".
- On every wake-up (sleep/signal/retry/recover), it **re-runs from the top** and fast-forwards using stored results:
  - `ctx.step("id", fn)` runs once, persists result, returns cached on replay.
  - `ctx.sleep(...)` and `ctx.waitForSignal(...)` persist durable checkpoints.

Rule: side effects belong inside `ctx.step(...)`.

## The happy path

1. **Register a durable resource** (store + queue + event bus).
2. **Write a durable task**:
   - stable `ctx.step("...")` ids
   - explicit `{ stepId }` for `sleep/emit/waitForSignal` in production
3. **Start the workflow**:
   - `executionId = await service.start(taskOrTaskId, input)`
   - persist `executionId` in your domain row (eg. `orders.execution_id`)
   - or `await service.startAndWait(taskOrTaskId, input)` to start + wait in one call
4. **Interact later via signals**:
   - look up `executionId`
   - `await service.signal(executionId, SignalDef, payload)`

For user-facing status pages, you can read the durable execution on-demand from the durable store using `executionId` (no need to mirror into Postgres): `store.getExecution(executionId)` (or `new DurableOperator(store).getExecutionDetail(executionId)` when supported).

Signals buffer if no waiter exists yet; the next `waitForSignal(...)` consumes the payload.

`taskOrTaskId` can be:

- an `ITask` (recommended, keeps full input/result type-safety)
- a task id `string` (resolved via runtime registry; fail-fast if not found)

`taskOrTaskId` is the built task object (`.build()`) or its id string, not the injected dependency callable from `.dependencies({...})`.

`start()` vs `startAndWait()`:

- `start(taskOrTaskId, input)` returns `executionId` immediately.
- `startAndWait(taskOrTaskId, input)` starts and waits for completion.

## Tagging workflows (required for discovery)

Durable workflows are regular Runner tasks, but **must be tagged with `durableWorkflowTag`** to make them discoverable at runtime. Always add this tag to your workflow tasks:

```ts
import { r } from "@bluelibs/runner";
import { memoryDurableResource, durableWorkflowTag } from "@bluelibs/runner/node";

const durable = memoryDurableResource.fork("app.durable");

const onboarding = r
  .task("app.workflows.onboarding")
  .dependencies({ durable })
  .tags([durableWorkflowTag.with({ category: "users" })])
  .run(async (_input, { durable }) => {
    const ctx = durable.use();
    await ctx.step("create-user", async () => ({ ok: true }));
    return {
      durable: { executionId: ctx.executionId },
      data: { ok: true },
    };
  })
  .build();

// Later, after run(...):
// const durableRuntime = runtime.getResourceValue(durable);
// const workflows = durableRuntime.getWorkflows();
```

The `durableWorkflowTag` is **required** — workflows without this tag will not be discoverable via `getWorkflows()`. The durable resources (`memoryDurableResource` / `redisDurableResource` / `durableResource`) auto-register this tag definition, so you can use it immediately without manual tag registration.

`durableWorkflowTag` also enforces a unified response shape: `{ durable: { executionId }, data }`.

### Starting workflows from dependencies (HTTP route)

Tagged tasks are for discovery/contracts. Start workflows explicitly via `durable.start(...)` (or `durable.startAndWait(...)` when you want to wait for completion):

```ts
import express from "express";
import { r, run } from "@bluelibs/runner";
import { memoryDurableResource, durableWorkflowTag } from "@bluelibs/runner/node";

const durable = memoryDurableResource.fork("app.durable");

const approveOrder = r
  .task("app.workflows.approveOrder")
  .dependencies({ durable })
  .tags([durableWorkflowTag.with({ category: "orders" })])
  .run(async (input: { orderId: string }, { durable }) => {
    const ctx = durable.use();
    await ctx.step("approve", async () => ({ approved: true }));
    return {
      durable: { executionId: ctx.executionId },
      data: { orderId: input.orderId, status: "approved" as const },
    };
  })
  .build();

const api = r
  .resource("app.api")
  .register([durable.with({ worker: false }), approveOrder])
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
import {
  memoryDurableResource,
  redisDurableResource,
} from "@bluelibs/runner/node";

// dev/tests
const durable = memoryDurableResource
  .fork("app.durable")
  .with({ worker: true });

// production (Redis + optional RabbitMQ queue)
const durableProd = redisDurableResource.fork("app.durable").with({
  redis: { url: process.env.REDIS_URL! },
  queue: { url: process.env.RABBITMQ_URL! },
  worker: true,
});
```

`waitForSignal()` return shapes:

- `await ctx.waitForSignal(Signal)` → `payload` (throws on timeout)
- `await ctx.waitForSignal(Signal, { timeoutMs })` → `{ kind: "signal", payload } | { kind: "timeout" }`

## Scheduling

- One-time: `service.schedule(taskOrTaskId, input, { at } | { delay })`
- Recurring: `service.ensureSchedule(taskOrTaskId, input, { id, cron } | { id, interval })`
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

There's also a dashboard middleware: `createDashboardMiddleware(service, new DurableOperator(store), { operatorAuth })` (operator actions are denied unless `operatorAuth` is provided; opt out with `dangerouslyAllowUnauthenticatedOperator: true`).

"Internal steps" are recorded steps created by durable primitives (`sleep/waitForSignal/emit` and some bookkeeping). They typically use reserved step id prefixes like `__...` or `rollback:...`.

Audit can be enabled via `audit: { enabled: true }`; inside workflows you can add replay-safe notes via `ctx.note("msg", meta)`. In Runner integration, audit entries are also emitted via `durableEvents.*`.

Runner integration detail: durable events emission does not depend on `audit.enabled` (it controls store persistence); events are emitted as long as an audit emitter is configured (the `durableResource` wires one by default).

Import and subscribe using event definitions (not strings): `import { durableEvents } from "@bluelibs/runner/node"` and `.on(durableEvents.audit.appended)` (or a specific durable event).

## Compensation / rollback

- `ctx.step("id").up(...).down(...)` registers compensations.
- `await ctx.rollback()` runs compensations in reverse order.

## Branching with ctx.switch()

`ctx.switch()` is a replay-safe branching primitive. It evaluates matchers against a value, persists which branch was taken, and on replay skips the matchers entirely.

```ts
const result = await ctx.switch(
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

- First arg is the step id (must be unique, like `ctx.step`).
- Matchers evaluate in order; first match wins.
- The matched branch `id` + result are persisted; on replay the cached result is returned immediately.
- Throws if no branch matches and no default is provided.
- Audit emits a `switch_evaluated` entry with `branchId` and `durationMs`.

## Describing a flow (static shape export)

Use `durable.describe(...)` to export the structure of a workflow without executing it. Useful for documentation, visualization, and tooling.

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

The recorder shims `durable.use()` inside the task's `run` and records every `ctx.*` operation.

Notes:

- The recorder captures each `ctx.*` call as a `FlowNode`; step bodies are never executed.
- Supported node kinds: `step`, `sleep`, `waitForSignal`, `emit`, `switch`, `note`.
- `DurableFlowShape` and all `FlowNode` types are exported for type-safe consumption.
- Conditional logic should be modeled with `ctx.switch()` (not JS `if/else`) for the shape to capture it.

## Versioning (don't get burned)

- Step ids are part of the durable contract: don't rename/reorder casually.
- For breaking behavior changes, ship a **new workflow task id** (eg. `...v2`) and route new starts to it while v1 drains.
- A "dispatcher/alias" task is great for _new starts_, but in-flight stability requires the version choice to be stable (don't silently change behavior under the same durable task id).

## Operational notes

- `ctx.emit(...)` is best-effort (notifications), not guaranteed delivery.
- Queue mode is at-least-once; correctness comes from the store + step memoization.
