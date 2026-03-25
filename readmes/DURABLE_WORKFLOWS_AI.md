# Durable Workflows — Token-Friendly Reference

← [Full documentation](./DURABLE_WORKFLOWS_FRESH.md)

---

Node-only: `@bluelibs/runner/node`. Workflows are tasks with checkpoints — on wake-up, they **re-run from top** and fast-forward via cached step results.

## Mental Model

```
First Run:   step1 → step2 → sleep → waitForSignal → step3
              saved   saved  saved     waiting        (not yet)

Resume:      step1 → step2 → sleep → waitForSignal → step3
              cached  cached cached    cached        executes
```

**Rule**: Side effects inside `step()`. Anything outside can run multiple times.

## Quick Setup

```ts
import { r, run } from "@bluelibs/runner";
import { resources, tags } from "@bluelibs/runner/node";

const durable = resources.memoryWorkflow.fork("app-durable");
const durableSerializer =
  resources.serializer.fork("app-durable-serializer");
const durableRegistration = durable.with({
  serializer: durableSerializer, // optional resource, not instance
  polling: { enabled: true },
  recovery: { onStartup: true },
});

const workflow = r
  .task("my-workflow")
  .dependencies({ durable })
  .tags([tags.durableWorkflow.with({ category: "orders" })])
  .run(async (input, { durable }) => {
    const d = durable.use();
    await d.step("validate", async () => {
      /* ... */
    });
    return { ok: true };
  })
  .build();

const app = r
  .resource("app")
  .register([resources.durable, durableRegistration, workflow])
  .build();

const runtime = await run(app);
const durableRuntime = runtime.getResourceValue(durable);
```

**Queue mode for memory** (optional, tests production-like topology):

- No `queue` → executions run directly/synchronously
- `queue: { consume: true }` → work dispatched through `MemoryQueue` + `DurableWorker`

**Serializer override** (optional):

- `serializer` expects a serializer resource definition
- default is `resources.serializer`
- for `memoryWorkflow`, it affects persisted `filePath` snapshots
- for `redisWorkflow`, it affects Redis store + bus payloads

## DurableContext API

```ts
const d = durable.use();

// Properties
d.executionId; // string
d.attempt; // number
```

### step()

```ts
// Basic — runs once, cached on replay
const order = await d.step("validate", async () => {
  return await db.orders.find(input.orderId);
});

// Cancellation-aware
await d.step("ship", async ({ signal }) => {
  signal.throwIfAborted();
  return await shippingApi.createLabel(orderId, { signal });
});

// With options
await d.step("charge", { retries: 3, timeout: 30_000 }, async () => {
  return await payments.charge(customerId, amount);
});

// With compensation (rollback)
const reservation = await d
  .step("reserve-inventory")
  .up(async () => inventory.reserve(items))
  .down(async (res) => inventory.release(res.reservationId));

const payment = await d
  .step("charge-payment")
  .up(async () => payments.charge(customerId, amount))
  .down(async (p) => payments.refund(p.chargeId));
```

Step callbacks receive `{ signal: AbortSignal }`. Replay hits return cached results and do not re-run the callback.
Cancellation-driven aborts do not consume step retries.

### sleep()

```ts
await d.sleep(60_000); // 1 minute
await d.sleep(60_000, { stepId: "delay" }); // With stable ID
```

Timer persisted in store. Survives process restart.

### waitForSignal()

```ts
const outcome = await d.waitForSignal(Paid, { timeoutMs: 86_400_000 });

if (outcome.kind === "timeout") {
  // Handle timeout
} else {
  // outcome.kind === "signal"
  console.log(outcome.payload.paidAt);
}

// Without timeout — returns payload directly
const signal = await d.waitForSignal(Paid);
// signal.kind === "signal"
```

| Option      | Effect                                              |
| ----------- | --------------------------------------------------- |
| `timeoutMs` | Changes return to `{ kind: "signal" \| "timeout" }` |
| `stepId`    | Stable ID for replay consistency                    |

### workflow() + waitForExecution()

```ts
// Start child
const childId = await d.workflow("start-payment", processPayment, input, {
  timeout: 300_000, // Child runtime timeout
  idempotencyKey: "order-123-payment", // Optional override
});

// Wait for child
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

Child failures (`failed`, `cancelled`, `compensation_failed`) throw `DurableExecutionError`.

### switch()

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
      run: async () => "standard",
    },
  ],
  { id: "fallback", run: async () => "needs-review" }, // runs when no match
);
```

Branch decision persisted. On replay: cached result returned, matchers skipped.

### emit()

```ts
await d.emit(OrderCompleted, { orderId: "123" });
```

Replay-safe. Uses internal step IDs like `__emit:orderCompleted:0`.

### rollback()

```ts
try {
  await d.step("risky", async () => {
    /* ... */
  });
} catch (error) {
  await d.rollback(); // Runs all .down() in reverse order
}
```

### note()

```ts
await d.note("Payment confirmed", { amount: 100, currency: "USD" });
```

No-op if audit disabled. Replay-safe.

## DurableService API

```ts
const durableRuntime = runtime.getResourceValue(durable);
```

### Execution Control

```ts
// Start (fire-and-track)
const executionId = await durableRuntime.start(task, input);
const executionId = await durableRuntime.start(task, input, {
  timeout: 300_000, // Workflow runtime timeout
  idempotencyKey: "order-123", // Deduplicate starts
});

// Start and wait
const result = await durableRuntime.startAndWait(task, input);
const result = await durableRuntime.startAndWait(task, input, {
  timeout: 300_000, // Workflow runtime timeout
  waitTimeout: 30_000, // Caller wait bound
});
// result = { durable: { executionId }, data }

// Wait for existing execution
const result = await durableRuntime.wait(executionId, { timeout: 30_000 });

// Deliver signal
await durableRuntime.signal(executionId, Paid, { paidAt: Date.now() });

// Cancel (cooperative)
await durableRuntime.cancelExecution(executionId, "User requested");
```

If a step is actively running, cancellation sets `cancelRequestedAt` immediately, aborts the step signal, and marks the execution `cancelled` once that attempt exits. Sleeping or waiting executions still cancel immediately.

### Scheduling

```ts
// One-time
await durableRuntime.schedule(task, input, {
  at: new Date("2025-06-01T10:00:00Z"),
});
await durableRuntime.schedule(task, input, { delay: 24 * 60 * 60 * 1000 }); // 24h

// Recurring cron
await durableRuntime.ensureSchedule(task, input, {
  id: "daily-report",
  cron: "0 9 * * *", // 9am daily
  timezone: "UTC",
});

// Recurring interval
await durableRuntime.ensureSchedule(task, input, {
  id: "health-check",
  interval: 30_000,
});

// Management
await durableRuntime.pauseSchedule("daily-report");
await durableRuntime.resumeSchedule("daily-report");
const schedule = await durableRuntime.getSchedule("daily-report");
const all = await durableRuntime.listSchedules();
await durableRuntime.updateSchedule("daily-report", {
  cron: "0 10 * * *",
  timezone: "UTC",
});
await durableRuntime.removeSchedule("daily-report");
```

Cron schedules use the process local timezone when `timezone` is omitted. Set an explicit IANA timezone for business-facing wall-clock schedules so DST behavior is predictable.

### Repository (Task-Scoped Queries)

```ts
const repo = durableRuntime.getRepository(task);

const exec = await repo.findOneOrFail({ id: executionId });
const list = await repo.find(
  { status: "completed", createdAt: { $gte: startDate } },
  { sort: { createdAt: -1 }, limit: 20 },
);
const tree = await repo.findTree({ id: parentExecutionId }); // With children
```

### Operator (Admin Actions)

```ts
const detail = await durableRuntime.operator.getExecutionDetail(executionId);
const stuck = await durableRuntime.operator.listStuckExecutions();
await durableRuntime.operator.forceFail(executionId, {
  message: "Manual override",
});
await durableRuntime.operator.skipStep(executionId, "failing-step");
await durableRuntime.operator.editStepResult(executionId, "step-id", newResult);
await durableRuntime.operator.retryRollback(executionId);
```

### Recovery

```ts
const report = await durableRuntime.recover();
```

Runs automatically at startup when `recovery.onStartup: true`.

## Signals

```ts
// Define signal
const Approved = r.event<{ approvedBy: string }>("approved").build();

// Wait in workflow
const outcome = await d.waitForSignal(Approved, { timeoutMs: 86_400_000 });
// outcome = { kind: "signal", payload } | { kind: "timeout" }

// Deliver from webhook/API
await durableRuntime.signal(executionId, Approved, {
  approvedBy: "admin@co.com",
});
```

**Buffering**: Early signals queue FIFO per `executionId + signalId`. `waitForSignal()` consumes oldest.

**Signal contract** (optional whitelist):

```ts
tags.durableWorkflow.with({
  signals: [Paid, Refunded], // Only these signal IDs allowed
});
```

## Child Workflows

```ts
const childId = await d.workflow("start-child", childTask, input);
const result = await d.waitForExecution(childTask, childId, {
  timeoutMs: 60_000,
});
```

- Auto-sets `parentExecutionId`
- Auto-derives `idempotencyKey` from `parentExecutionId + stepId`
- Child `failed`/`cancelled`/`compensation_failed` throws `DurableExecutionError`

## Compensation Pattern

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
      await d.step("ship-order", async () => shipping.ship(input.orderId));
      return { success: true };
    } catch (error) {
      await d.rollback(); // refund → release, in reverse order
      return { success: false, error: error.message };
    }
  })
  .build();
```

## Scheduling Patterns

### How It Works

```
ensureSchedule(task, input, { id, cron, timezone? })
    → Persists Schedule { id, workflowKey, input, type, pattern, timezone?, active }
    → Computes nextRun
    → Persists Timer { id: "sched:id", fireAt, scheduleId }

Polling Loop (when polling.enabled: true)
    → claimReadyTimers(now, availableSlots, workerId, claimTtlMs)
      claims only as many ready timers as this worker can process now
    → handleScheduledTaskTimer()
        → Create execution (idempotencyKey: "timer:sched:ID:fireAt")
        → kickoffExecution() → run workflow
        → reschedule() → compute next run, persist new timer
```

**Properties**:

- Idempotent — safe to call on every boot
- Crash-safe — schedule + timer in store
- Deduped — same tick uses same `idempotencyKey`
- Backpressured — polling drains ready timers in bounded waves instead of
  releasing the whole backlog at once

`polling.concurrency` is per worker.

- `10` means one worker handles up to 10 timers at a time
- total cluster drain capacity scales with worker count
- keep the default unless you have measurements proving a higher value is safe

### One-Time vs Recurring

| Type               | API                                             | Use Case                      |
| ------------------ | ----------------------------------------------- | ----------------------------- |
| One-time           | `schedule(task, input, { at } \| { delay })`    | Reminders, delayed actions    |
| Recurring cron     | `ensureSchedule(task, input, { id, cron, timezone? })` | Daily reports, weekly cleanup |
| Recurring interval | `ensureSchedule(task, input, { id, interval })` | Health checks, polling        |

### Interval Behavior

Intervals measured from **kickoff time**, not completion. Long-running tasks may overlap:

```
Task starts at t=0, takes 12s
Interval = 10s

t=0          t=10         t=12
|------------|------------|
  run A        run B       A completes
```

For non-overlapping: use `d.sleep()` at end of workflow.

### Bootstrap Pattern

Call `ensureSchedule` at app startup — safe to call repeatedly:

```ts
const bootstrap = r
  .resource("bootstrap")
  .dependencies({ durable })
  .init(async (_, { durable }) => {
    await durable.ensureSchedule(
      dailyCleanup,
      {},
      { id: "daily-cleanup", cron: "0 3 * * *", timezone: "UTC" },
    );
    await durable.ensureSchedule(
      healthCheck,
      { endpoints: ["api", "db"] },
      { id: "health-check", interval: 30_000 },
    );
  })
  .build();
```

## Production Setup

### Dependencies

```bash
npm install ioredis amqplib
```

### Configuration

```ts
const durable = resources.redisWorkflow.fork("app-durable");

// Worker node (consumes queue + polls)
const workerConfig = durable.with({
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

// API node (no background work)
const apiConfig = durable.with({
  redis: { url: process.env.REDIS_URL! },
  queue: { url: process.env.RABBITMQ_URL! }, // transport only, no consume
  polling: { enabled: false },
});
```

When polling is enabled, the durable store must support
`claimReadyTimers(...)` so workers can split timer backlogs safely. Polling
fails fast at startup if that contract is missing.

### Architecture

| Component     | Role                                                   |
| ------------- | ------------------------------------------------------ |
| Redis store   | Source of truth (executions, steps, timers, schedules) |
| RabbitMQ      | Work distribution (fast path)                          |
| Redis pub/sub | Notifications for `wait()` (fast path)                 |

**Rule**: RabbitMQ makes it fast; Redis makes it correct.

## Testing

```ts
import { createDurableTestSetup, waitUntil } from "@bluelibs/runner/node";

const { durable, durableRegistration, store } = createDurableTestSetup();

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
await durableRuntime.wait(executionId);

await runtime.dispose();
```

## Gotchas

| Issue                  | Fix                                                    |
| ---------------------- | ------------------------------------------------------ |
| Side effect runs twice | Move inside `step()`                                   |
| Replay diverges        | Keep step IDs stable                                   |
| Signal not delivered   | Verify `executionId` matches stored                    |
| Compensation fails     | Fix downstream, use `retryRollback()`                  |
| Intervals overlap      | Use `d.sleep()` for completion-based spacing           |
| Timers don't fire      | Ensure `polling.enabled: true` in at least one process |

## Reserved Step IDs

Avoid `__` and `rollback:` prefixes — reserved for internals.

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
  completedAt?: Date;
}

interface Schedule<TInput = unknown> {
  id: string;
  workflowKey: string;
  type: "cron" | "interval";
  pattern: string;
  timezone?: string;
  input: TInput | undefined;
  status: "active" | "paused";
  lastRun?: Date;
  nextRun?: Date;
}
```
