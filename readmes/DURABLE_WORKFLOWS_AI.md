# Durable Workflows (Node-only) — Token-Friendly Guide

Durable workflows are Runner tasks with **replay-safe checkpoints**.
If your process restarts (deploys, crashes, scale-out), the workflow continues from the last checkpoint.

- Node-only export: `@bluelibs/runner/node` (implementation lives in `src/node/durable/`)
- Full guide: `readmes/DURABLE_WORKFLOWS.md`

## Core Primitives

Inside a durable task you get a `DurableContext` (via `durable.use()`):

- `ctx.step(id, fn)` — run once, memoize result, replay from store
- `ctx.sleep(ms, { stepId? })` — durable timer (survives restarts; use `stepId` for replay stability)
- `ctx.waitForSignal(signalDef, { timeoutMs?, stepId? })` — suspend until an external signal arrives
- `ctx.emit(eventDef, payload, { stepId? })` — best-effort cross-worker notification (replay-safe via internal steps)
- `ctx.rollback()` — run registered compensations in reverse order

## Minimal Setup

Use `durableResource.fork("app.durable").with(...)` so the service can execute Runner tasks via DI, while the application owns the final resource id and supplies configuration via `with()`.

```ts
	import { r } from "@bluelibs/runner";
	import {
	  durableResource,
	  MemoryStore,
	} from "@bluelibs/runner/node";

	const durable = durableResource.fork("app.durable");
	const durableRegistration = durable.with({ store: new MemoryStore() });

		const processOrder = r
		  .task("app.tasks.processOrder")
		  .dependencies({ durable })
		  .run(async (input: { orderId: string }, { durable }) => {
		    const ctx = durable.use();
		    const charged = await ctx.step("charge", async () => {
		      return { chargeId: "ch_1" };
		    });

		    const OrderApproved = r.event<{ approvedBy: string }>("orders.approved").build();
		    const OrdersProcessed = r.event<{
		      orderId: string;
		      approved: { approvedBy: string };
		    }>("orders.processed").build();

	    await ctx.sleep(5_000);

	    const approved = await ctx.waitForSignal(OrderApproved);

	    await ctx.emit(OrdersProcessed, { orderId: input.orderId, approved });

	    return { ok: true, charged };
	  })
	  .build();

	const app = r
	  .resource("app")
	  .register([durableRegistration, processOrder])
	  .build();
```

## Executing And Waiting For Results

```ts
	import { run } from "@bluelibs/runner/node";

	const runtime = await run(app);
	const service = await runtime.getResourceValue(durable);

const executionId = await service.startExecution(processOrder, {
  orderId: "o1",
});

const result = await service.wait<{ ok: true }>(executionId);
```

If you want stricter type-safety (and to prevent tasks that can return `undefined`):

```ts
const result = await service.executeStrict(processOrder, { orderId: "o1" });
```

	## Scheduling (One-Time / Cron / Interval)

Use scheduling for background jobs and delayed work. Schedules are driven by the durable polling loop (timers), so keep `polling.enabled` on in the process responsible for polling.

```ts
	// One-time run
	await service.schedule(processOrder, { orderId: "o1" }, { at: new Date(Date.now() + 60_000) });
	await service.schedule(processOrder, { orderId: "o1" }, { delay: 60_000 });

	// Recurring (idempotent; recommended for boot-time setup)
	await service.ensureSchedule(processOrder, { orderId: "o1" }, { id: "orders.hourly", cron: "0 * * * *" });
	await service.ensureSchedule(processOrder, { orderId: "o1" }, { id: "orders.poll", interval: 30_000 });

// Manage recurring schedules
await service.pauseSchedule("orders.hourly");
await service.resumeSchedule("orders.hourly");
await service.updateSchedule("orders.hourly", { cron: "0 */2 * * *" });
await service.removeSchedule("orders.hourly");
```

## Signals (Type-Safe)

`waitForSignal()` and `durableService.signal()` accept **event definitions** (`IEventDefinition<TPayload>`).

Create them with Runner’s `event<T>({ id })` helper (preferred).

```ts
		const OrderApproved = r.event<{ approvedBy: string }>("orders.approved").build();

	// In the workflow:
	const approved = await ctx.waitForSignal(OrderApproved);

// From the outside:
await service.signal(executionId, OrderApproved, { approvedBy: "Ada" });
```

## Steps (Type-Safe)

To avoid repeating `<T>` generics at every `step()` call, you can define typed step ids:

```ts
import { createDurableStepId } from "@bluelibs/runner/node";

const Charge = createDurableStepId<{ chargeId: string }>("charge");

const charged = await ctx.step(Charge, async () => {
  return { chargeId: "ch_1" };
});
```

	## Notes On Safety

	- **Step IDs are part of the durable contract.** Changing a step id changes replay behavior.
	- Internal step ids starting with `__` and `rollback:` are reserved.
	- Avoid implicit internal ids (`sleep/emit/waitForSignal` without `{ stepId }`) in concurrent flows (`Promise.all`); always use explicit `stepId` there.
	- Timeouts are not cancellation; timed-out async work may still finish later and perform side effects.
	- Dependency injection does not make side effects replay-safe; keep them inside `ctx.step(...)` / `ctx.emit(...)`.

## Configuration Knobs (Common)

- `execution: { timeout, maxAttempts }` (can be overridden per call via `execute(..., { timeout })` / `wait(..., { timeout })`)
- `polling: { enabled, interval, claimTtlMs }` (timers, signal timeouts, schedules)
- `workerId` (unique per process; used for distributed timer claims when `store.claimTimer` is supported)
- `taskResolver` (resolve tasks by id when resuming/recovering without registering every task up-front)
- `contextProvider` (AsyncLocalStorage-style context propagation for `durable.use()` in Runner runtimes)

## Logging via Runner events

In Runner integration (`durableResource`), workflow lifecycle events are emitted via `durableEvents.*` by default. Listen to `durableEvents.audit.appended` and log based on `entry.kind`:

```ts
import { r, globals } from "@bluelibs/runner";
import { durableEvents } from "@bluelibs/runner/node";

const logDurable = r
  .hook("app.hooks.durableLog")
  .dependencies({ logger: globals.resources.logger })
  .on(durableEvents.audit.appended)
  .run(async (ev, { logger }) => {
    const { entry } = ev.data;
    await logger.info("durable.audit", {
      kind: entry.kind,
      executionId: entry.executionId,
      taskId: entry.taskId,
      attempt: entry.attempt,
      at: entry.at,
    });
  })
  .build();
```
- `emit()` is **best-effort** (notifications), not guaranteed delivery. For exactly-once integration, rely on idempotent external APIs + `step()`.

## Audit Trail (Timeline)

Durable can persist an audit trail as the workflow executes so you can later inspect:

- status transitions (`pending` → `running` → `sleeping` → `completed`, etc.)
- step completions (with durations)
- sleeps scheduled/completed
- signals waiting/delivered/timed-out
- custom notes you add from within the workflow

Enable it via `durableResource.fork("app.durable").with({ audit: { enabled: true }, ... })` (default: off). It requires store support:

- `IDurableStore.appendAuditEntry(entry)`
- `IDurableStore.listAuditEntries(executionId)`

### Add a custom note

```ts
await ctx.note("created-payment-intent", { paymentIntentId: "pi_123" });
```

Notes are replay-safe (the same note won't be duplicated across resumes).

### Example entries

```ts
// execution_status_changed
{ kind: "execution_status_changed", executionId: "exec_1", taskId: "app.tasks.processOrder", attempt: 1, from: "pending", to: "running" }

// step_completed
{ kind: "step_completed", executionId: "exec_1", taskId: "app.tasks.processOrder", attempt: 1, stepId: "charge", durationMs: 87, isInternal: false }

// signal_waiting
{ kind: "signal_waiting", executionId: "exec_1", taskId: "app.tasks.processOrder", attempt: 1, signalId: "orders.approved", stepId: "__signal:orders.approved" }

// note
{ kind: "note", executionId: "exec_1", taskId: "app.tasks.processOrder", attempt: 1, message: "created-payment-intent", meta: { paymentIntentId: "pi_123" } }
```

### Stream audit entries via Runner events (for mirroring)

If you want to mirror workflow activity to cold storage (S3/Glacier/Postgres), listen to Runner events (they are excluded from `on("*")` global hooks by default, so subscribe explicitly).

If you also want a persisted timeline in the durable store (for dashboards), enable `audit: { enabled: true }` and use a store that supports `appendAuditEntry`/`listAuditEntries`.

```ts
import { r } from "@bluelibs/runner";
import { durableEvents } from "@bluelibs/runner/node";

const mirrorAudit = r
  .hook("app.hooks.durableAuditMirror")
  .on(durableEvents.audit.appended)
  .run(async (event) => {
    const { entry } = event.data;
    // write entry to your cold store (idempotent by entry.id)
  })
  .build();
```

## Dashboard UI

There is a small Express middleware to inspect executions and run operator actions (retry rollback, skip step, force fail, patch step result):

```ts
import express from "express";
import { createDashboardMiddleware, DurableOperator } from "@bluelibs/runner/node";

app.use(
  "/durable-dashboard",
  createDashboardMiddleware(service, new DurableOperator(store)),
);
```

From this repo (source), build the UI once via `npm run build:dashboard` (generates `dist/ui/`).
