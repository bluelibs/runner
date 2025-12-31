# Durable Workflows (Node-only) — Token-Friendly Guide

Durable workflows are Runner tasks with **replay-safe checkpoints**.
If your process restarts (deploys, crashes, scale-out), the workflow continues from the last checkpoint.

- Node-only export: `@bluelibs/runner/node` (implementation lives in `src/node/durable/`)
- Full guide: `readmes/DURABLE_WORKFLOWS.md`

## Core Primitives

Inside a durable task you get a `DurableContext` (via `durableContext`):

- `ctx.step(id, fn)` — run once, memoize result, replay from store
- `ctx.sleep(ms)` — durable timer (survives restarts)
- `ctx.waitForSignal(signal)` — suspend until an external signal arrives
- `ctx.emit(event, payload)` — best-effort cross-worker notification (replay-safe via internal steps)
- `ctx.rollback()` — run registered compensations in reverse order

## Minimal Setup

Use `createDurableServiceResource()` so the service can execute Runner tasks via DI.

```ts
import { r } from "@bluelibs/runner";
import {
  createDurableServiceResource,
  durableContext,
  DurableService,
  MemoryStore,
} from "@bluelibs/runner/node";

const durableService = createDurableServiceResource({
  store: new MemoryStore(),
});

const processOrder = r
  .task("app.tasks.processOrder")
  .dependencies({ durableContext })
  .run(async (input: { orderId: string }, { durableContext: ctx }) => {
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

const app = r.resource("app").register([durableService, processOrder]).build();
```

## Executing And Waiting For Results

```ts
import { run } from "@bluelibs/runner/node";

const runtime = await run(app);
const service = await runtime.getResourceValue(durableService);

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
