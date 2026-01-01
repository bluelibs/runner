# Durable Workflows (Node-only) — Token-Friendly Guide

Durable workflows are Runner tasks with **replay-safe checkpoints**.
If your process restarts (deploys, crashes, scale-out), the workflow continues from the last checkpoint.

- Node-only export: `@bluelibs/runner/node` (implementation lives in `src/node/durable/`)
- Full guide: `readmes/DURABLE_WORKFLOWS.md`

## Core Primitives

Inside a durable task you get a `DurableContext` (via `durable.use()`):

- `ctx.step(id, fn)` — run once, memoize result, replay from store
- `ctx.sleep(ms)` — durable timer (survives restarts)
- `ctx.waitForSignal(signal)` — suspend until an external signal arrives
- `ctx.emit(event, payload)` — best-effort cross-worker notification (replay-safe via internal steps)
- `ctx.rollback()` — run registered compensations in reverse order

## Minimal Setup

Use `createDurableResource()` so the service can execute Runner tasks via DI and provide a per-resource durable context.

```ts
	import { r } from "@bluelibs/runner";
	import {
	  createDurableResource,
	  MemoryStore,
	} from "@bluelibs/runner/node";

	const durable = createDurableResource("app.durable", { store: new MemoryStore() });

	const processOrder = r
	  .task("app.tasks.processOrder")
	  .dependencies({ durable })
	  .run(async (input: { orderId: string }, { durable }) => {
	    const ctx = durable.use();
	    const charged = await ctx.step("charge", async () => {
	      return { chargeId: "ch_1" };
	    });

    await ctx.sleep(5_000);

    const approved = await ctx.waitForSignal<{ approvedBy: string }>(
      "orders.approved",
    );

    await ctx.emit("orders.processed", { orderId: input.orderId, approved });

    return { ok: true, charged };
  })
  .build();

	const app = r
	  .resource("app")
	  .register([durable, processOrder])
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

## Signals (Type-Safe)

`waitForSignal()` and `durableService.signal()` accept:

- `string` ids: `"orders.approved"`
- Runner event defs: `r.event("...").payloadSchema<...>().build()`
- Durable signal ids: `createDurableSignalId<TPayload>("...")`

```ts
import { createDurableSignalId } from "@bluelibs/runner/node";

const OrderApproved = createDurableSignalId<{ approvedBy: string }>(
  "orders.approved",
);

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
- `emit()` is **best-effort** (notifications), not guaranteed delivery. For exactly-once integration, rely on idempotent external APIs + `step()`.

## Audit Trail (Timeline)

Durable can persist an audit trail as the workflow executes so you can later inspect:

- status transitions (`pending` → `running` → `sleeping` → `completed`, etc.)
- step completions (with durations)
- sleeps scheduled/completed
- signals waiting/delivered/timed-out
- custom notes you add from within the workflow

Enable it via `createDurableResource("app.durable", { audit: { enabled: true }, ... })` (default: off). It requires store support:

- `IDurableStore.appendAuditEntry(entry)`
- `IDurableStore.listAuditEntries(executionId)`

### Add a custom note

```ts
await ctx.note("created-payment-intent", { paymentIntentId: "pi_123" });
```

Notes are replay-safe (the same note won't be duplicated across resumes).

### Stream audit entries via Runner events (for mirroring)

If you want to mirror audit entries to cold storage (S3/Glacier/Postgres), enable:

- `audit: { enabled: true, emitRunnerEvents: true }`

Then listen to Runner events (they are excluded from `on("*")` global hooks by default, so subscribe explicitly):

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
