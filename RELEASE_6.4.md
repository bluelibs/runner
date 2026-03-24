# Runner 6.4 Release Notes

> Branch `feat/6.4` → `main` | 32 commits | 272 files changed

---

## Overview

6.4 is the **Durable Workflows era** release. The headline change is a substantial rethinking of how durable workflow executions are persisted, identified, orchestrated, and recovered. Several types and APIs that shipped as optional or exploratory in earlier versions have been hardened, made required, or replaced with cleaner alternatives.

There are **breaking changes** in this release — mostly confined to the durable layer. If you are not using durable workflows you can upgrade with minimal friction (see the small set of non-durable changes at the bottom).

If you are already running durable workflows in production, read the **End-to-End Upgrade Guide** near the bottom before upgrading. The safe rollout order matters here.

---

## Breaking Changes

### 1. `Execution.taskId` → `Execution.workflowKey`

The `taskId` field on the `Execution` type has been renamed to `workflowKey`. This is a **data-level rename** — values already persisted in a store will need a migration if you read them directly.

All internal consumers (queue messages, store queries, error constructors, filters) have been updated to the new name.

**Why:** `taskId` was the raw runtime canonical id, which was leaky and fragile. `workflowKey` now maps to the value declared via `durableWorkflow.with({ key })`, making it stable across renames and independent of the runtime registry id.

Important rollout note: if you are upgrading an existing durable deployment, do **not** introduce a new `durableWorkflow.with({ key })` in the same deploy unless you also intend to migrate existing persisted `workflowKey` values. Otherwise old executions will stay grouped under the old canonical id while new executions move to the new stable key.

---

### 2. `IDurableStore` contract is now fully required

Several store methods that were previously optional are now **required** on `IDurableStore`:

| Was optional        | Now required |
| ------------------- | ------------ |
| `listExecutions()`  | ✅ required  |
| `listStepResults()` | ✅ required  |

The old two-step idempotency helpers have been replaced with a single atomic operation:

```ts
// REMOVED (optional pair):
getExecutionIdByIdempotencyKey?(...)
setExecutionIdByIdempotencyKey?(...)

// ADDED (required, atomic):
createExecutionWithIdempotencyKey(params: {
  execution: Execution;
  workflowKey: string;
  idempotencyKey: string;
}): Promise<{ created: true; executionId: string } | { created: false; executionId: string }>
```

Additionally the full **signal journaling API** and **execution waiter API** are now part of the core store contract (previously scattered between optional extensions). Custom store implementations targeting this layer will need updates.

---

### 3. `describe()` removed — replaced by `getRepository()`

`IDurableResource.describe(task, input)` which ran a dry-run recording pass (via `DurableFlowShape`) has been **removed** along with the entire `flowShape.ts` module.

It is replaced by `getRepository<TInput, TResult>(task)`, which returns a live, fully typed read API against store data:

```ts
// REMOVED:
await durable.describe(myWorkflowTask, sampleInput);

// ADDED:
const repo = durable.getRepository(myWorkflowTask);
const records = await repo.find({ status: "running" });
const tree = await repo.findTree({ parentExecutionId: null });
const one = await repo.findOneOrFail({ id: executionId });
```

**Why:** `describe()` was a static recording that could only approximate a workflow's shape. The repository gives real execution data and supports rich filtering, sorting, and tree traversal.

---

### 4. `DurableServiceConfig.worker` → `roles`

The `worker: boolean` top-level config field on durable resources has been replaced with a structured `roles` object:

```ts
// REMOVED:
{
  worker: true;
}

// ADDED:
{
  roles: {
    queueConsumer: true;
  }
}
```

Queue creation also changed — the queue is **no longer auto-created** when `worker: true` was set. You must now explicitly declare both intent to use a queue and intent to consume it:

```ts
// redisDurableResource / memoryDurableResource
{
  queue: {
    enabled: true,   // creates the queue transport
    consume: true,   // this instance will consume messages
  }
}
```

For the built-in Runner workflow resources (`resources.memoryWorkflow` / `resources.redisWorkflow`), prefer the `queue.consume` switch above. The lower-level `roles.queueConsumer` knob still exists for custom durable runtime wiring.

---

### 5. `ScheduleConfig` is now a discriminated union

`cron` and `interval` are now mutually exclusive at the type level. Previously both were independently optional; the new `RecurringScheduleConfig` enforces exactly one:

```ts
// TypeScript will now catch:
{ id: "x", task: myTask, input: {}, cron: "* * * * *", interval: 60_000 } // ❌ compile error
```

---

### 6. `ExecuteOptions.waitPollIntervalMs` relocated

`waitPollIntervalMs` has been moved out of `ExecuteOptions` and into a dedicated `WaitOptions` interface used internally. It is still present in `StartAndWaitOptions` (which extends `ExecuteOptions`).

`timeout` was **not** renamed. `ExecuteOptions.timeout` still exists and still bounds workflow runtime.

`StartAndWaitOptions` now properly separates two distinct timeout semantics:

```ts
interface StartAndWaitOptions extends ExecuteOptions {
  waitTimeout?: number; // how long the *caller* waits before giving up
  waitPollIntervalMs?: number; // polling cadence if pub/sub not available
  // ExecuteOptions.timeout → bounds the workflow's own runtime
}
```

---

### 7. `ListExecutionsOptions.taskId` → `workflowKey`

The store-level filter for listing executions now uses `workflowKey`:

```ts
store.listExecutions({ workflowKey: "order-processing" });
```

---

### 8. `RedisStore` legacy support removed

The legacy migration compatibility paths inside `RedisStore` have been stripped. If your store data relied on legacy key formats you will need to run a migration before upgrading.

---

## New Features

### Workflow Orchestration: `context.workflow()`

Durable contexts gain a `workflow()` method for replay-safe child workflow starting:

```ts
step("kick-off-child", async () => {
  const childId = await ctx.workflow(
    processOrderTask,
    { orderId },
    {
      timeout: 60_000,
    },
  );
  // childId is memoized — replays return the same id without re-starting
});
```

- Automatically derives a deterministic idempotency key from `parentExecutionId + stepId`
- Forwards `parentExecutionId` to the child for tree-building
- Only accepts tasks tagged with `durableWorkflow`

---

### Workflow Orchestration: `context.waitForExecution()`

Durable contexts can now suspend waiting for another workflow execution to complete:

```ts
const result = await ctx.waitForExecution(processOrderTask, childExecutionId, {
  timeoutMs: 30_000,
  stepId: "wait-child-order",
})

if (result.kind === "timeout") { ... }
if (result.kind === "completed") { ... result.value ... }
```

---

### `IDurableExecutionRepository` — Live Execution Read API

Accessed via `durable.getRepository(task)`, the repository exposes a typed, collection-style query interface over a task's execution history:

```ts
const repo = durable.getRepository<OrderInput, OrderResult>(processOrderTask);

// list with filters + pagination
const records = await repo.find(
  { status: "failed", createdAt: { $gte: new Date("2026-01-01") } },
  { sort: { createdAt: -1 }, limit: 10 },
);

// fetch complete execution + steps + audit in one call
const { execution, steps, audit } = await repo.findOneOrFail({ id });

// recursive child-workflow tree
const forest = await repo.findTree({ parentExecutionId: null });
```

Each record includes `execution`, `steps`, and `audit` entries.

---

### `RecoveryManager` — Automatic Orphan Recovery

A new `RecoveryManager` identifies orphaned executions (those that failed mid-flight without reaching a terminal state) and re-queues them for retry:

```ts
// DurableServiceConfig
{
  recovery: {
    onStartup: true,     // runs a drain on every worker boot
    concurrency: 10,     // max parallel recovery attempts
    claimTtlMs: 30_000,  // distributed claim TTL to avoid double-recovery
  }
}
```

Recovery uses the same failsafe kickoff path as normal starts so idempotency guarantees hold.

---

### Live Execution Current-State Tracking

New `DurableExecutionCurrent*` types give operator tooling and dashboards a canonical snapshot of what a suspended workflow is actively doing:

- `DurableExecutionCurrentSleep` — suspended in `sleep()`, with exact wake-up timestamp
- `DurableExecutionCurrentSignalWait` — suspended in `waitForSignal()`, with signal id + timeout info
- `DurableExecutionCurrentExecutionWait` — suspended in `waitForExecution()`, with target execution id + workflow key
- `DurableExecutionCurrentStep` — actively running user code inside a durable step

---

### Failsafe Kickoff for Non-Created Executions

Execution kickoff now uses a `kickoffWithFailsafe()` path that gracefully handles the case where a queue message arrives for an execution that was never fully persisted (e.g. a crash between enqueue and store commit). This closes a subtle race window that could cause executions to be silently lost.

---

### Execution Parent Linkage

`ExecuteOptions` gains `parentExecutionId?: string` for linking child workflow starts to their parent. This powers `findTree()` in the repository and makes operator tooling aware of execution hierarchies:

```ts
await durable.start(myTask, input, { parentExecutionId: ctx.executionId });
```

---

### `dispose.abortWindowMs` — Cooperative Abort Phase in Shutdown

The shutdown lifecycle gains an optional cooperative-abort window after the graceful drain period expires:

```ts
r.run(app, {
  dispose: {
    totalBudgetMs: 30_000,
    cooldownWindowMs: 5_000,
    abortWindowMs: 5_000, // NEW: abort in-flight task signals, then wait this long
  },
});
```

When the graceful drain does not complete within budget, Runner aborts its tracked task-local signals and waits up to `abortWindowMs` for business work to cooperatively settle before forcing disposal.

---

### `RedisEventBus.disposeProvidedClient`

External clients passed into `RedisEventBus` are no longer closed on `dispose()` by default (the caller owns them). If you want the bus to close your client, opt in explicitly:

```ts
new RedisEventBus({ redis: myClient, disposeProvidedClient: true });
```

---

### `IDurableQueue.cancelConsumer()`

The queue interface gains an optional `cancelConsumer()` method that stops the active consumer without tearing down the full queue transport. Durable workers use this during graceful shutdown so message deliveries do not outlive the service/store lifecycle.

---

### Worker Cooldown

`DurableWorker` now exposes a `cooldown()` method for a graceful shutdown phase, allowing in-flight message processing to complete before the worker is fully stopped.

---

### Budget: Minute-Rejected Request Counting

The budget middleware now also tracks minute-window rejected requests in addition to the existing counters, improving observability for rate-limiting dashboards.

---

### RPC Lanes Async Context Propagation

RPC lanes now propagate async context through the allowlist system with per-task and per-event granularity, enabling correct context threading across remote calls.

---

## Bug Fixes

| Area                    | Fix                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `redisCache`            | Malformed or corrupted cache payloads are now treated as cache misses instead of propagating parse errors upward |
| `rateLimit`             | Type safety enforced for `keyBuilder` callback; runtime config validation now runs eagerly via compiled schema   |
| RPC lanes               | Resource references for event and RPC lanes now resolve correctly in all configurations                          |
| Event lane auth         | Auth readiness checks refactored to avoid false negatives during startup                                         |
| Durable signal timeouts | Signal timeout errors are now correctly surfaced and tested                                                      |

---

## Dependency Updates

All production and development dependencies bumped to latest stable versions for improved security and compatibility.

---

## End-to-End Upgrade Guide

### Who Needs Which Path

- If you only use `memoryWorkflow` in tests/dev and do not persist durable data between runs, this is mostly a **code/API upgrade**.
- If you use the built-in Redis durable store and you already have persisted executions, this is a **code + data + rollout** upgrade.
- If you maintain a custom `IDurableStore`, this is a **code + interface + data** upgrade.

### Recommended Rollout Order

1. Freeze workflow identities for the upgrade window.
   Keep task ids stable during the first 6.4 rollout. Do not rename workflow tasks and do not introduce new `durableWorkflow.with({ key })` values in the same deploy unless you are intentionally migrating stored `workflowKey` values too.
2. Upgrade application code to the 6.4 APIs.
   Update config, repository access, and store call sites first while preserving your existing logical workflow identity.
3. Migrate persisted durable data if you use Redis or a custom persisted store.
   This includes the execution payload rename to `workflowKey` and any removed legacy storage layouts.
4. Deploy workers only after the store shape matches 6.4 expectations.
   Pollers, queue consumers, recovery, and repositories all assume the new shape.
5. Verify live behavior on one known workflow before broad rollout.
   Start, wait, signal, recover, and inspect one execution end-to-end.
6. Only after the upgrade is stable, optionally introduce stable `durableWorkflow.with({ key })` values in a second migration.

### Step 1: Update Durable Application Code

Rename execution-facing reads from `taskId` to `workflowKey`:

```ts
// Before
execution.taskId;
store.listExecutions({ taskId: "app.tasks.process-order" });

// After
execution.workflowKey;
store.listExecutions({ workflowKey: "app.tasks.process-order" });
```

Replace `describe()` with repositories:

```ts
// Before
const shape = await durable.describe(processOrderTask, sampleInput);

// After
const repo = durable.getRepository(processOrderTask);
const records = await repo.find();
const detail = await repo.findOneOrFail({ id: executionId });
```

Update `startAndWait()` call sites to use the new caller-timeout field:

```ts
// Before
await durable.startAndWait(processOrderTask, input, {
  timeout: 60_000,
  waitPollIntervalMs: 250,
});

// After
await durable.startAndWait(processOrderTask, input, {
  timeout: 60_000,          // workflow runtime budget
  waitTimeout: 5_000, // caller wait budget
  waitPollIntervalMs: 250,
});
```

`waitTimeout` is new. It does **not** replace `timeout`:

- `timeout` still controls how long the workflow execution itself is allowed to run
- `waitTimeout` controls how long the caller of `startAndWait()` is willing to wait

If you do not want a caller-side wait budget, omit `waitTimeout` and keep using only `timeout`.

Examples:

```ts
// Example 1:
// The workflow is allowed to run for up to 60s,
// but this caller only wants to wait 5s for the answer.
await durable.startAndWait(processOrderTask, input, {
  timeout: 60_000,
  waitTimeout: 5_000,
});
```

If `processOrderTask` finishes in 2 seconds, the caller receives the result normally.

If `processOrderTask` is still running after 5 seconds, `startAndWait()` throws a wait timeout,
but the workflow execution itself may continue in the background until it completes, fails, or hits
its own 60-second execution timeout.

```ts
// Example 2:
// The caller is willing to wait a long time,
// but the workflow itself is only allowed to run for 5s.
await durable.startAndWait(processOrderTask, input, {
  timeout: 5_000,
  waitTimeout: 60_000,
});
```

If the workflow does not finish within 5 seconds, the workflow times out first. The caller does not
keep waiting for 60 seconds because the execution has already ended with a workflow timeout/failure.

```ts
// Example 3:
// If you want "stop waiting, but keep tracking the execution",
// use start() + wait() so you always keep the executionId.
const executionId = await durable.start(processOrderTask, input, {
  timeout: 60_000,
});

try {
  const data = await durable.wait(executionId, {
    timeout: 5_000,
    waitPollIntervalMs: 250,
  });

  console.log("completed quickly", data);
} catch (error) {
  console.log("caller stopped waiting, execution may still be running", {
    executionId,
    error,
  });

  const repo = durable.getRepository(processOrderTask);
  const execution = await repo.findOneOrFail({ id: executionId });

  console.log("latest known durable status", execution.status);
}
```

Update schedule definitions so they choose exactly one cadence type:

```ts
// Before
{ id: "orders", task: processOrderTask, cron: "* * * * *", interval: 60_000, input: {} }

// After
{ id: "orders", task: processOrderTask, cron: "* * * * *", input: {} }
// or
{ id: "orders", task: processOrderTask, interval: 60_000, input: {} }
```

### Step 2: Update Durable Resource Config

For built-in Runner resources, treat queue creation and queue consumption as explicit:

```ts
// Before
const durable = resources.redisWorkflow.fork("orders-durable").with({
  redis: { url: process.env.REDIS_URL! },
  queue: { url: process.env.RABBITMQ_URL! },
  worker: true,
});

// After
const durable = resources.redisWorkflow.fork("orders-durable").with({
  redis: { url: process.env.REDIS_URL! },
  queue: {
    enabled: true,
    consume: true,
    url: process.env.RABBITMQ_URL!,
  },
  recovery: { onStartup: true },
});
```

For low-level custom durable runtime wiring, replace `worker: true` with:

```ts
{
  roles: {
    queueConsumer: true,
  },
}
```

### Step 3: Migrate Persisted Durable Data

If you persist durable data outside memory-only test/dev setups, migrate the store before re-enabling durable workers.

Minimum data migration checklist:

- Rewrite execution payloads from `taskId` to `workflowKey`.
- Update any direct store queries, dashboards, exports, or reports that read `taskId`.
- If you maintain custom idempotency records keyed by task id, move them to the workflow-key namespace.
- If your Redis data still uses removed legacy key layouts, migrate those records into the current shapes before upgrade.

For Redis users, the important removed legacy read paths are:

- legacy per-step keys: `step:<executionId>:<stepId>`
- current step bucket hash: `steps:<executionId>`
- legacy per-audit-entry keys: `audit:<executionId>:<entryId>`
- current audit bucket hash: `audit:<executionId>`

Recommended Redis rollout:

1. Pause or drain durable queue consumers and pollers.
2. Take a Redis backup / snapshot.
3. Run the migration that rewrites execution payloads and any legacy step/audit layouts.
4. Deploy the 6.4 app code.
5. Re-enable consumers, polling, and recovery.

### Step 4: Be Deliberate About `durableWorkflow.with({ key })`

`workflowKey` now resolves from:

1. `durableWorkflow.with({ key })`, when present
2. otherwise the canonical runtime task id

That means adding a new durable tag `key` is a **logical identity migration**, not just metadata.

Safe recommendation for existing systems:

- First upgrade to 6.4 while keeping your old logical workflow identity.
- If your old system already relied on canonical task ids, let 6.4 continue using that fallback for one rollout.
- Introduce stable `key` values later in a second migration, after you have decided how existing executions should be grouped and queried.

If you do want to introduce `key` during upgrade, migrate all persisted workflow-grouped data consistently:

- `execution.workflowKey`
- workflow-scoped idempotency records
- any external dashboards/reports keyed by the old task id

Otherwise repository reads such as `durable.getRepository(task).find(...)` will show only the new executions while older ones stay under the previous identity.

### Step 5: Custom Store Implementers

If you own a custom `IDurableStore`, the 6.4 contract work is not optional.

Required interface updates:

- remove `getExecutionIdByIdempotencyKey` / `setExecutionIdByIdempotencyKey`
- add atomic `createExecutionWithIdempotencyKey(...)`
- implement `listExecutions(...)`
- implement `listStepResults(...)`
- implement the full signal journaling surface
- implement the full execution waiter surface

Treat this as both an API migration and a data-contract migration. The durable layer now assumes these capabilities exist consistently.

### Step 6: Verify the Upgrade End-to-End

Before broad rollout, verify one real workflow path end-to-end:

- `start()` creates a new execution.
- `startAndWait()` respects `waitTimeout`.
- `signal()` still resumes waiting workflows.
- `recover()` can re-drive a deliberately orphaned execution.
- `durable.getRepository(task).findOneOrFail({ id })` returns execution, steps, and audit as expected.
- `durable.operator.getExecutionDetail(id)` still exposes the same execution history you expect.

If Redis-backed historical executions suddenly show empty `steps` or `audit`, or repositories stop seeing pre-upgrade runs, treat that as a migration issue before continuing rollout.
