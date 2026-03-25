# Durable Workflows (Node-only)

← [Back to main README](../README.md)

---

> Workflows with checkpoints. If your process dies, deploys, or scales horizontally, the workflow resumes from its last checkpoint.

## Table of Contents

- [When to Use](#when-to-use)
- [The Mental Model](#the-mental-model)
- [Quickstart](#quickstart)
- [DurableContext API](#durablecontext-api)
- [DurableService API](#durableservice-api)
- [Workflow Identity & Tagging](#workflow-identity--tagging)
- [Signals](#signals)
- [Child Workflows](#child-workflows)
- [Compensation / Rollback](#compensation--rollback)
- [Branching with switch()](#branching-with-switch)
- [Scheduling & Cron](#scheduling--cron)
- [Production Setup](#production-setup)
- [Scaling & Topology](#scaling--topology)
- [Testing](#testing)
- [Operator & Observability](#operator--observability)
- [Safety Guarantees](#safety-guarantees)
- [Custom Backends](#custom-backends)
- [Troubleshooting](#troubleshooting)
- [Type Reference](#type-reference)

---

## When to Use

Durable workflows fit when:

- Your workflow spans time: minutes, hours, days (payments, shipping, approvals)
- You need deterministic retries without duplicating side-effects
- You want horizontal scaling without "who owns this in-memory timeout?" problems
- You want explicit, type-safe "outside world pokes the workflow" via signals

You can use durable workflows standalone—no need to port your entire app to Runner first.

---

## The Mental Model

**The key insight**: workflows are functions with checkpoints. On wake-up, the workflow **re-runs from the top**, but completed steps return their cached result immediately.

```
┌────────────────────────────────────────────────────────────┐
│  First Run                                                 │
│  ┌─────┐   ┌─────┐   ┌─────┐   ┌──────────┐   ┌─────┐      │
│  │step1│ → │step2│ → │sleep│ → │waitForSig│ → │step3│      │
│  └──┬──┘   └──┬──┘   └──┬──┘   └────┬─────┘   └──┬──┘      │
│     │         │         │           │            │         │
│     ▼         ▼         ▼           ▼            ▼         │
│   saved     saved    saved        waiting      (not yet)   │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  Resume (after signal arrives)                             │
│  ┌─────┐   ┌─────┐   ┌─────┐   ┌──────────┐   ┌─────┐      │
│  │step1│ → │step2│ → │sleep│ → │waitForSig│ → │step3│      │
│  └──┬──┘   └──┬──┘   └──┬──┘   └────┬─────┘   └──┬──┘      │
│     │         │         │           │            │         │
│     ▼         ▼         ▼           ▼            ▼         │
│   cached   cached   cached       cached       executes     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**Critical rules**:

1. Side effects belong **inside** `durableContext.step(...)` — anything outside can run multiple times
2. Step IDs must stay stable — renaming a step breaks replay for in-flight executions
3. The store is the source of truth — queues and pub/sub are optimizations

---

## Quickstart

### 1. Create a durable resource

```ts
import { r, run } from "@bluelibs/runner";
import { resources, tags } from "@bluelibs/runner/node";

const durable = resources.memoryWorkflow.fork("app-durable"); // forking is just making a copy

const durableRegistration = durable.with({
  persist: { filePath: "./.runner/durable-memory.json" }, // Optional: persist memory store state to disk for local restart drills
  queue: { consume: true }, // Optional: test queue-mode semantics
  polling: { enabled: true }, // Drive timers/sleeps/timeouts with bounded fan-out
  recovery: { onStartup: true }, // Recover orphaned executions on boot
});
```

**Queue mode for in-memory?**

| Config                     | Behavior                                                 |
| -------------------------- | -------------------------------------------------------- |
| No `queue`                 | Executions run directly/synchronously in same call stack |
| `queue: { consume: true }` | Work dispatched through `MemoryQueue` + `DurableWorker`  |

Use `queue: { consume: true }` when testing production-like topology (signals, child workflows). Omit for simpler tests.

`persist: { filePath }` makes `resources.memoryWorkflow` reload its durable store state from a local file on boot.
This is designed for single-process local/dev workflows and crash-recovery testing.
It does not turn the memory backend into a shared multi-node store, and it does not persist in-process `MemoryQueue` / `MemoryEventBus` subscribers.

### 2. Define a durable workflow task

```ts
const Approved = r.event<{ approvedBy: string }>("approved").build();

const approveOrder = r
  .task("approve-order")
  .dependencies({ durable })
  .tags([tags.durableWorkflow.with({ category: "orders" })])
  .run(async (input: { orderId: string }, { durable }) => {
    const d = durable.use();

    await d.step("validate", async () => {
      // fetch order, validate invariants
      return { ok: true };
    });

    const outcome = await d.waitForSignal(Approved, {
      timeoutMs: 86_400_000, // 24 hours
    });

    if (outcome.kind === "timeout") {
      return { status: "timed_out" };
    }

    await d.step("ship", async () => {
      // ship after approval
      return { shipped: true };
    });

    return { status: "approved", approvedBy: outcome.payload.approvedBy };
  })
  .build();
```

### 3. Register and run

```ts
const app = r
  .resource("app")
  .register([
    resources.durable, // Required: provides tags + events
    durableRegistration,
    approveOrder,
  ])
  .build();

const runtime = await run(app);
const durableRuntime = runtime.getResourceValue(durable);
```

### 4. Start executions from your API

```ts
// Fire-and-track
const executionId = await durableRuntime.start(approveOrder, {
  orderId: "order-123",
});

// Start-and-wait (convenience)
const result = await durableRuntime.startAndWait(approveOrder, {
  orderId: "order-123",
});
// result = { durable: { executionId }, data: { status: "approved", ... } }
```

### 5. Resume from webhooks

```ts
// In your webhook handler
await durableRuntime.signal(executionId, Approved, {
  approvedBy: "admin@company.com",
});
```

---

## DurableContext API

`DurableContext` is the per-execution toolkit you access via `durable.use()`.

### Properties

```ts
readonly executionId: string;
readonly attempt: number;
```

### `step()` — Deterministic Checkpoint

```ts
// Basic form
await d.step("validate", async () => {
  return await db.orders.find(input.orderId);
});

// Cancellation-aware form
await d.step("ship", async ({ signal }) => {
  signal.throwIfAborted();
  return await shippingApi.createLabel(orderId, { signal });
});

// With options
await d.step("charge", { retries: 3, timeout: 30_000 }, async () => {
  return await payments.charge(customerId, amount);
});

// Builder form (with compensation)
const reservation = await d
  .step("reserve-inventory")
  .up(async () => inventory.reserve(items))
  .down(async (res) => inventory.release(res.reservationId));
```

| Option    | Description                                                          |
| --------- | -------------------------------------------------------------------- |
| `retries` | Retry attempts on non-cancellation failures (default: 0)             |
| `timeout` | Step-level timeout in ms                                             |

**Builder methods**:

| Method      | Description                      |
| ----------- | -------------------------------- |
| `.up(fn)`   | Forward action (required)        |
| `.down(fn)` | Compensation/rollback (optional) |

Step callbacks receive `{ signal: AbortSignal }`.
Replay hits return the cached step result immediately, so the callback is not re-run and the signal is only relevant when the step executes live.
Cancellation-driven aborts are treated as cooperative cancellation, not retryable step failures.

### `sleep()` — Durable Suspension

```ts
await d.sleep(60_000); // 1 minute
await d.sleep(60_000, { stepId: "delay" }); // With stable ID
```

Sleeps survive process restarts. The timer is persisted in the store.

### `waitForSignal()` — External Event Wait

```ts
// Returns discriminated union when timeoutMs is set
const outcome = await d.waitForSignal(Paid, { timeoutMs: 86_400_000 });

if (outcome.kind === "timeout") {
  // handle timeout
} else {
  // outcome.kind === "signal"
  console.log(outcome.payload.paidAt);
}

// Without timeout — returns payload directly
const signal = await d.waitForSignal(Paid);
// signal.kind === "signal"
```

| Option      | Description                                  |
| ----------- | -------------------------------------------- |
| `timeoutMs` | Timeout in ms (changes return type to union) |
| `stepId`    | Stable ID for replay consistency             |

### `waitForExecution()` — Child Workflow Wait

```ts
const childId = await d.workflow("start-child", processPayment, input);

// With timeout
const result = await d.waitForExecution(processPayment, childId, {
  timeoutMs: 60_000,
});

if (result.kind === "timeout") {
  // handle timeout
} else {
  // result.kind === "completed"
  console.log(result.data);
}
```

Child failures (`failed`, `cancelled`, `compensation_failed`) throw `DurableExecutionError`.

### `workflow()` — Start Child Workflow

```ts
const childExecutionId = await d.workflow(
  "start-payment",
  processPayment,
  input,
  {
    timeout: 300_000, // Child runtime timeout
    idempotencyKey: "order-123-payment", // Override auto-derived key
  },
);
```

Auto-derives `idempotencyKey` from `parentExecutionId + stepId` when not provided.

### `emit()` — Durable Event Emission

```ts
await d.emit(OrderCompleted, { orderId: "123" });
```

Implemented as internal step(s) with IDs like `__emit:orderCompleted:0`. Replay-safe.

### `switch()` — Replay-Safe Branching

```ts
const route = await d.switch(
  "fulfillment-route",
  order.tier,
  [
    {
      id: "priority",
      match: (tier) => tier === "premium",
      run: async () => {
        await d.step("express-ship", async () => shipping.express(order));
        return "express";
      },
    },
    {
      id: "standard",
      match: (tier) => tier === "standard",
      run: async () => {
        await d.step("standard-ship", async () => shipping.standard(order));
        return "standard";
      },
    },
  ],
  { id: "manual", run: async () => "needs-review" }, // default branch
);
```

Branch decision is persisted. On replay, cached result returns without re-evaluating matchers.

### `rollback()` — Execute Compensations

```ts
try {
  await d.step("risky-operation", async () => {
    /* ... */
  });
} catch (error) {
  await d.rollback(); // Runs all .down() handlers in reverse order
  return { success: false };
}
```

### `note()` — Audit Trail Entry

```ts
await d.note("Payment confirmed", { amount: 100, currency: "USD" });
```

No-op if audit is disabled. Replay-safe.

---

## DurableService API

Access via `runtime.getResourceValue(durableResource)`.

### Execution Control

```ts
// Start (fire-and-track)
const executionId = await durable.start(task, input);
const executionId = await durable.start(task, input, {
  timeout: 300_000, // Workflow runtime timeout
  idempotencyKey: "order-123", // Deduplicate starts
});

// Start and wait for completion
const result = await durable.startAndWait(task, input);
const result = await durable.startAndWait(task, input, {
  timeout: 300_000, // Workflow runtime timeout
  waitTimeout: 30_000, // Caller wait bound
});
// result = { durable: { executionId }, data }

// Wait for existing execution
const result = await durable.wait(executionId, { timeout: 30_000 });

// Deliver a signal
await durable.signal(executionId, Paid, { paidAt: Date.now() });

// Cancel (cooperative)
await durable.cancelExecution(executionId, "User requested");
```

If the execution is currently running inside a step, cancellation becomes a live request first:

- `cancelRequestedAt` is stored immediately
- the step's `AbortSignal` flips to `aborted`
- the execution becomes terminal `cancelled` once the running attempt exits

Suspended executions (`sleep()`, waits, pending/retrying) still cancel immediately.

### Scheduling

```ts
// One-time schedule
const executionId = await durable.schedule(task, input, {
  at: new Date("2025-06-01T10:00:00Z"),
});
const executionId = await durable.schedule(task, input, {
  delay: 24 * 60 * 60 * 1000, // 24 hours from now
});

// Recurring cron
await durable.ensureSchedule(task, input, {
  id: "daily-cleanup",
  cron: "0 3 * * *",
  timezone: "UTC",
});

// Recurring interval
await durable.ensureSchedule(task, input, {
  id: "health-check",
  interval: 30_000,
});

// Schedule management
await durable.pauseSchedule("daily-cleanup");
await durable.resumeSchedule("daily-cleanup");
const schedule = await durable.getSchedule("daily-cleanup");
const schedules = await durable.listSchedules();
await durable.updateSchedule("daily-cleanup", {
  cron: "0 4 * * *",
  timezone: "UTC",
});
await durable.removeSchedule("daily-cleanup");
```

### Repository (Task-Scoped Queries)

```ts
const repo = durable.getRepository(approveOrder);

const execution = await repo.findOneOrFail({ id: executionId });
const recent = await repo.find(
  { status: "completed", createdAt: { $gte: startDate } },
  { sort: { createdAt: -1 }, limit: 20 },
);
const tree = await repo.findTree({ id: parentExecutionId });
```

### Operator (Admin Actions)

```ts
const stuck = await durable.operator.listStuckExecutions();
const detail = await durable.operator.getExecutionDetail(executionId);
await durable.operator.forceFail(executionId, { message: "Manual override" });
await durable.operator.skipStep(executionId, "failing-step");
await durable.operator.editStepResult(executionId, "step-id", newResult);
await durable.operator.retryRollback(executionId);
```

### Recovery

```ts
const report = await durable.recover();
```

Runs automatically at startup when `recovery.onStartup: true`.

---

## Workflow Identity & Tagging

Durable workflows must be tagged for discovery:

```ts
import { tags } from "@bluelibs/runner/node";

r.task("payment").tags([
  tags.durableWorkflow.with({
    key: "billing.payment", // Stable key (survives refactors)
    category: "billing", // Optional grouping
    signals: [Paid, Refunded], // Optional signal contract
  }),
]);
```

| Field      | Description                                                                        |
| ---------- | ---------------------------------------------------------------------------------- |
| `key`      | Stable workflow identity persisted in executions. Falls back to canonical task ID. |
| `category` | Optional grouping for dashboards                                                   |
| `signals`  | Whitelist of allowed signals. Omit for backwards-compatible any-signal mode.       |

**Why `key` matters**: The canonical task ID changes when you move/rename tasks. A stable `key` lets in-flight executions survive refactors.

---

## Signals

Signals let the outside world resume a suspended workflow.

### Basic Pattern

```ts
// Define signal
const Approved = r.event<{ approvedBy: string }>("approved").build();

// Wait in workflow
const outcome = await d.waitForSignal(Approved, { timeoutMs: 86_400_000 });

// Deliver from outside
await durable.signal(executionId, Approved, { approvedBy: "admin@co.com" });
```

### Return Types

| Call                                   | Returns                                                |
| -------------------------------------- | ------------------------------------------------------ |
| `waitForSignal(signal)`                | `{ kind: "signal", payload }`                          |
| `waitForSignal(signal, { timeoutMs })` | `{ kind: "signal", payload }` \| `{ kind: "timeout" }` |

### Signal Buffering

Early-arriving signals are queued. When `waitForSignal()` is called:

1. Check for queued signals → consume oldest (FIFO)
2. No queued signals → record waiter, suspend

Signals are retained in execution-level history for observability.

### Signal Contract

```ts
tags.durableWorkflow.with({
  signals: [Paid, Refunded], // Only these signal IDs allowed
});
```

When `signals` is omitted, any signal ID is accepted (backwards compatible).

---

## Child Workflows

### Starting Children

```ts
const childId = await d.workflow("start-child", processPayment, input);
```

This:

- Memoizes `childId` in parent (replay-safe)
- Sets `parentExecutionId` linkage
- Auto-derives `idempotencyKey` from `parentExecutionId + stepId`

### Waiting for Children

```ts
const result = await d.waitForExecution(processPayment, childId, {
  timeoutMs: 60_000,
});

if (result.kind === "timeout") {
  // Handle timeout
} else {
  // result.kind === "completed"
  console.log(result.data);
}
```

Child terminal states:

| Status                | Behavior                       |
| --------------------- | ------------------------------ |
| `completed`           | Returns result                 |
| `failed`              | Throws `DurableExecutionError` |
| `cancelled`           | Throws `DurableExecutionError` |
| `compensation_failed` | Throws `DurableExecutionError` |

---

## Compensation / Rollback

Explicit, code-based rollback instead of automatic saga orchestration:

```ts
const processOrder = r
  .task("process-order")
  .dependencies({ durable })
  .run(async (input, { durable }) => {
    const d = durable.use();

    const reservation = await d
      .step("reserve-inventory")
      .up(async () => inventory.reserve(input.items))
      .down(async (res) => inventory.release(res.reservationId));

    const payment = await d
      .step("charge-payment")
      .up(async () => payments.charge(input.customerId, input.amount))
      .down(async (p) => payments.refund(p.chargeId));

    try {
      const shipment = await d.step("ship-order", async () => {
        return await shipping.ship(input.orderId);
      });
      return { success: true, shipment };
    } catch (error) {
      await d.rollback(); // Runs compensations in reverse order
      return { success: false, error: error.message };
    }
  })
  .build();
```

Compensation failures result in `compensation_failed` status. Use `operator.retryRollback()` after fixing the underlying issue.

---

## Branching with switch()

Replay-safe conditional logic:

```ts
const result = await d.switch(
  "route",
  order.tier,
  [
    {
      id: "priority",
      match: (tier) => tier === "premium",
      run: async () => "express",
    },
    {
      id: "standard",
      match: (tier) => tier === "standard",
      run: async () => "standard",
    },
  ],
  { id: "fallback", run: async () => "needs-review" }, // runs when no match
);
```

**Semantics**:

- First run: evaluate matchers in order, persist winning branch
- Replay: return cached result without re-running matchers
- No match + no fallback: throws

---

## Scheduling & Cron

Durable scheduling persists schedule definitions and timers in the store. The polling loop (not in-memory timers) drives execution, making schedules crash-safe and horizontally scalable.

### How It Works

```
┌────────────────────────────────────────────────────────────────┐
│ ensureSchedule(task, input, {                                  │
│   id: "daily", cron: "0 9 * * *", timezone: "UTC"              │
│ })                                                             │
│                                                                │
│ 1. Persists Schedule record:                                   │
│    { id, workflowKey, input, type: "cron", pattern,            │
│      timezone, active }                                        │
│                                                                │
│ 2. Computes next run: 2025-03-25 09:00:00                      │
│                                                                │
│ 3. Persists Timer record:                                      │
│    { id: "sched:daily", fireAt, scheduleId, type: "scheduled"} │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────────┐
│ Polling Loop (enabled: true, interval: 1000ms, concurrency: 10)│
│                                                                │
│ Every tick / wake:                                             │
│ 1. claimReadyTimers(now, availableSlots, workerId, ttlMs)      │
│ 2. handleScheduledTaskTimer(timer):                            │
│    - Create execution (idempotencyKey: "timer:sched:daily:...")│
│    - kickoffExecution() → run workflow                         │
│    - reschedule() → compute next run, persist new timer        │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**Key properties**:

| Property        | Description                                                                           |
| --------------- | ------------------------------------------------------------------------------------- |
| Idempotent      | Safe to call on every boot. Updates existing schedule if `id` matches.                |
| Crash-safe      | Schedule + timer in store. Process restart → polling continues.                       |
| Backpressured   | Workers claim only up to local polling concurrency instead of draining the whole ready set at once. |
| Deduped         | Uses `idempotencyKey: timer:sched:ID:fireAt` to prevent duplicate runs for same tick. |
| Rebinding guard | Cannot change `workflowKey` on existing schedule (throws).                            |

### Polling Backpressure

`polling.concurrency` is a per-worker cap, not a global cap.

- One worker with `concurrency: 10` handles up to 10 timers at a time.
- Four workers with `concurrency: 10` can drain up to about 40 timers at a
  time across the cluster.
- This is intentional: backlog recovery after downtime or a cron burst happens
  in controlled waves instead of one unbounded stampede.

Start with the default `10` unless you have measurements showing the store,
queue, and workflow handlers can comfortably sustain more.

> **Note:** When polling is enabled, the durable store must implement
> `claimReadyTimers(...)`. The poller will fail fast on startup rather than
> silently falling back to full ready-set scans.

### One-Time Execution

```ts
// Run at specific time
await durable.schedule(task, input, { at: new Date("2025-06-01T10:00:00Z") });

// Run after delay
await durable.schedule(task, input, { delay: 60_000 }); // 1 min from now
```

Creates a single timer. No schedule record. Timer fires once, execution runs, done.

### Recurring Execution

```ts
// Cron (calendar-based)
await durable.ensureSchedule(task, input, {
  id: "daily-report",
  cron: "0 9 * * *", // 9am daily
  timezone: "UTC",
});

// Interval (fixed delay between kickoffs)
await durable.ensureSchedule(task, input, {
  id: "health-check",
  interval: 30_000, // every 30 seconds
});
```

**Interval vs Cron**:

| Type     | Next Run Calculation     | Use Case                           |
| -------- | ------------------------ | ---------------------------------- |
| Cron     | Next calendar match      | Reports, cleanup at specific times |
| Interval | `lastKickoff + interval` | Health checks, polling             |

**Interval caveat**: Measured from kickoff time, not completion. Long-running tasks may overlap. Use `d.sleep()` at the end of the workflow for completion-based spacing.

**Timezone note**: Cron schedules use the process local timezone when `timezone` is omitted. Set an explicit IANA timezone such as `"UTC"` or `"America/New_York"` for user-facing schedules so DST shifts stay intentional.

### Schedule Management

```ts
await durable.pauseSchedule("daily-report"); // Stop scheduling new runs
await durable.resumeSchedule("daily-report"); // Resume
const schedule = await durable.getSchedule("daily-report");
const all = await durable.listSchedules();
await durable.updateSchedule("daily-report", {
  cron: "0 10 * * *",
  timezone: "UTC",
});
await durable.removeSchedule("daily-report"); // Delete schedule + timer
```

### Cron Format

```
┌───────────── minute (0-59)
│ ┌─────────── hour (0-23)
│ │ ┌───────── day of month (1-31)
│ │ │ ┌─────── month (1-12)
│ │ │ │ ┌───── day of week (0-6)
│ │ │ │ │
* * * * *
```

Common patterns: `0 * * * *` (hourly), `0 0 * * *` (daily midnight), `0 9 * * MON-FRI` (weekdays 9am).

DST example with explicit timezone:

```ts
await durable.ensureSchedule(task, input, {
  id: "daily-ny-report",
  cron: "0 9 * * *",
  timezone: "America/New_York",
});
```

This keeps the schedule at 9:00 AM New York time across DST. On March 13, 2027 it resolves to `2027-03-13T14:00:00.000Z`; on March 14, 2027 it resolves to `2027-03-14T13:00:00.000Z`.

---

## Production Setup

### Dependencies

```bash
npm install ioredis amqplib
```

### Resource Configuration

```ts
import { resources } from "@bluelibs/runner/node";

const durable = resources.redisWorkflow.fork("app-durable");

const durableRegistration = durable.with({
  redis: { url: process.env.REDIS_URL! },
  queue: {
    url: process.env.RABBITMQ_URL!,
    consume: true,
    quorum: true,
    deadLetter: "durable-dlq",
  },
  polling: { enabled: true, interval: 1000, concurrency: 10 }, // per worker
  recovery: { onStartup: true },
});
```

`concurrency: 10` is a conservative default meant to smooth backlog recovery.
Raise it only after measuring durable store pressure, queue pressure, and timer
handler cost in your own topology.

### Role Separation

**API nodes** (no background work):

```ts
const durableRegistration = durable.with({
  redis: { url: process.env.REDIS_URL! },
  queue: { url: process.env.RABBITMQ_URL! },
  polling: { enabled: false }, // No timer driving
});
```

**Worker nodes** (consume + poll):

```ts
const durableRegistration = durable.with({
  redis: { url: process.env.REDIS_URL! },
  queue: { url: process.env.RABBITMQ_URL!, consume: true },
  polling: { enabled: true, interval: 1000, concurrency: 10 }, // per worker
  recovery: { onStartup: true },
});
```

### Isolation

Resource IDs derive key prefixes. Use different `.fork("id")` values to run multiple durable apps on the same Redis/RabbitMQ.

---

## Scaling & Topology

```
┌───────────────────────────────────────────────────────────┐
│                        Clients                            │
│                 ┌─────────────────────┐                   │
│                 │     API Nodes       │                   │
│                 │  start/signal/wait  │                   │
│                 └──────────┬──────────┘                   │
│                            │                              │
└────────────────────────────┼──────────────────────────────┘
                             │
                 ┌───────────▼───────────┐
                 │       RabbitMQ        │
                 │     Quorum Queue      │
                 └───────────┬───────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       │                     │                     │
 ┌─────▼─────┐         ┌─────▼─────┐         ┌─────▼─────┐
 │  Worker 1 │         │  Worker 2 │         │  Worker N │
 │  consume  │         │  consume  │         │  consume  │
 │   poll    │         │   poll    │         │   poll    │
 └─────┬─────┘         └─────┬─────┘         └─────┬─────┘
       │                     │                     │
       └─────────────────────┼─────────────────────┘
                             │
                 ┌───────────▼───────────┐
                 │        Redis          │
                 │   State + Pub/Sub     │
                 └───────────────────────┘
```

**Scaling characteristics**:

- Add workers → throughput scales linearly
- Workers coordinate via store (not in-memory state)
- Crash safety: other workers recover orphaned executions
- Locks prevent duplicate processing

---

## Testing

```ts
import { createDurableTestSetup, waitUntil } from "@bluelibs/runner/node";

const { durable, durableRegistration, store } = createDurableTestSetup();

const task = r
  .task("test-workflow")
  .dependencies({ durable })
  .run(async (_, { durable }) => {
    const d = durable.use();
    const signal = await d.waitForSignal(TestSignal);
    return signal.payload;
  })
  .build();

const app = r
  .resource("test-app")
  .register([resources.durable, durableRegistration, task])
  .build();

const runtime = await run(app);
const durableRuntime = runtime.getResourceValue(durable);

const executionId = await durableRuntime.start(task);

await waitUntil(
  async () => (await store.getExecution(executionId))?.status === "sleeping",
  { timeoutMs: 1000, intervalMs: 10 },
);

await durableRuntime.signal(executionId, TestSignal, { value: 42 });
const result = await durableRuntime.wait(executionId);

await runtime.dispose();
```

### Real Backend Integration Tests

```bash
DURABLE_INTEGRATION=1 \
DURABLE_TEST_REDIS_URL=redis://127.0.0.1:6379 \
DURABLE_TEST_RABBIT_URL=amqp://127.0.0.1:5672 \
npm run coverage:ai
```

---

## Operator & Observability

### Execution Status

```ts
const repo = durable.getRepository(workflowTask);
const execution = await repo.findOneOrFail({ id: executionId });

execution.status; // "pending" | "running" | "sleeping" | ...
execution.current; // Live position (see below)
execution.result; // Final result (when completed)
execution.error; // Error details (when failed)
```

### Live Position (`execution.current`)

| Kind               | Meaning                           |
| ------------------ | --------------------------------- |
| `step`             | Running user code in a step       |
| `switch`           | Evaluating branch matchers        |
| `sleep`            | Suspended in `sleep()`            |
| `waitForSignal`    | Suspended in `waitForSignal()`    |
| `waitForExecution` | Suspended in `waitForExecution()` |

Waiting states are durable truth (persisted). Running states are best-effort (may be stale after worker loss).

### Audit Trail

Enable via config:

```ts
durable.with({
  audit: { enabled: true },
});
```

Events recorded:

- Status transitions
- Step completions (with durations)
- Sleep scheduled/completed
- Signal waiting/delivered/timed-out
- User notes via `d.note()`

Stream to external storage:

```ts
durable.with({
  audit: { enabled: true, emitRunnerEvents: true },
});

// Listen
r.hook("audit-mirror")
  .on(durableEvents.audit.appended)
  .run(async (event) => {
    await writeToColdStorage(event.data.entry);
  });
```

---

## Safety Guarantees

| Guarantee               | Description                                                                   |
| ----------------------- | ----------------------------------------------------------------------------- |
| Store is truth          | All state persists in `IDurableStore`. Queue/pub-sub are optimizations.       |
| At-least-once execution | Executions retry on failure. Steps run at-most-once per execution (memoized). |
| Durable sleep           | Timers persist. Resume after process restart.                                 |
| Signal buffering        | Early signals queue until workflow waits.                                     |
| Recovery                | Orphaned executions discovered and resumed on startup.                        |
| Locks                   | Only one worker processes an execution at a time.                             |

**Reserved step IDs**: Avoid `__` and `rollback:` prefixes.

---

## Custom Backends

### IDurableStore

```ts
interface IDurableStore {
  // Core
  saveExecution(execution: Execution): Promise<void>;
  getExecution(id: string): Promise<Execution | null>;
  listIncompleteExecutions(): Promise<Execution[]>;

  // Steps
  getStepResult(executionId: string, stepId: string): Promise<StepResult | null>;
  saveStepResult(result: StepResult): Promise<void>;

  // Timers
  createTimer(timer: Timer): Promise<void>;
  getReadyTimers(now?: Date): Promise<Timer[]>;
  claimReadyTimers(now: Date, limit: number, workerId: string, ttlMs: number): Promise<Timer[]>;
  markTimerFired(timerId: string): Promise<void>;

  // Schedules
  createSchedule(schedule: Schedule): Promise<void>;
  getSchedule(id: string): Promise<Schedule | null>;
  listSchedules(): Promise<Schedule[]>;

  // Idempotency
  createExecutionWithIdempotencyKey(params): Promise<{ created: boolean; executionId: string }>;

  // Signals
  getSignalState(executionId: string, signalId: string): Promise<DurableSignalState | null>;
  appendSignalRecord(...): Promise<void>;
  bufferSignalRecord(...): Promise<void>;
  // ... see interfaces/store.ts for full contract
}
```

`getReadyTimers()` remains useful for inspection and recovery-style queries.
The live poller uses `claimReadyTimers(...)` so each worker only claims the
number of ready timers it can currently process.

### IDurableQueue

```ts
interface IDurableQueue {
  enqueue<T>(message: Omit<QueueMessage<T>, "id">): Promise<string>;
  consume<T>(handler: MessageHandler<T>): Promise<void>;
  ack(messageId: string): Promise<void>;
  nack(messageId: string, requeue?: boolean): Promise<void>;
}
```

### IEventBus

```ts
interface IEventBus {
  publish(channel: string, event: BusEvent): Promise<void>;
  subscribe(channel: string, handler: EventHandler): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
}
```

---

## Troubleshooting

| Issue                  | Cause                    | Fix                                        |
| ---------------------- | ------------------------ | ------------------------------------------ |
| Side effect runs twice | Code outside `step()`    | Move to `step()`                           |
| Replay diverges        | Renamed step ID          | Keep IDs stable                            |
| Signals not delivered  | Wrong execution ID       | Verify stored ID matches                   |
| Workflow stuck         | Worker died mid-step     | Recovery loop picks it up                  |
| Compensation fails     | Downstream service issue | Fix issue, use `retryRollback()`           |
| Intervals overlap      | Long-running task        | Use `sleep()` for completion-based spacing |

---

## Type Reference

```ts
type ExecutionStatus =
  | "pending"
  | "running"
  | "retrying"
  | "sleeping"
  | "completed"
  | "failed"
  | "compensation_failed"
  | "cancelled";

interface Execution<TInput = unknown, TResult = unknown> {
  id: string;
  workflowKey: string;
  parentExecutionId?: string;
  input: TInput | undefined;
  status: ExecutionStatus;
  result?: TResult;
  error?: { message: string; stack?: string };
  attempt: number;
  maxAttempts: number;
  timeout?: number;
  current?: DurableExecutionCurrent;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

interface StepResult<T = unknown> {
  executionId: string;
  stepId: string;
  result: T;
  completedAt: Date;
}

type TimerType =
  | "sleep"
  | "timeout"
  | "scheduled"
  | "cron"
  | "retry"
  | "signal_timeout";

interface Timer {
  id: string;
  executionId?: string;
  scheduleId?: string;
  type: TimerType;
  fireAt: Date;
  status: "pending" | "fired";
}

type ScheduleType = "cron" | "interval";

interface Schedule<TInput = unknown> {
  id: string;
  workflowKey: string;
  type: ScheduleType;
  pattern: string;
  timezone?: string;
  input: TInput | undefined;
  status: "active" | "paused";
  lastRun?: Date;
  nextRun?: Date;
}
```

---

## What's Not Included

| Feature                            | Reason                               |
| ---------------------------------- | ------------------------------------ |
| Exactly-once external side effects | Left to idempotent APIs              |
| Automatic saga orchestration       | Explicit code is clearer             |
| Built-in dashboard                 | Intentionally external               |
| Cross-region sharding              | Out of scope for v1                  |
| Preemptive cancellation            | Node can't interrupt arbitrary async |

These can be added later without breaking the core API.
