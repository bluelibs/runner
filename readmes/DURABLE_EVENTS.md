# Durable Event Bridge

The Node durable event bridge runs a selected event emission as a durable workflow. Each exact-event hook becomes a persisted step. Emit the event normally; Runner selects the backend, creates the execution, and waits for completion.

```ts
import { r, run } from "@bluelibs/runner";
import { resources, tags } from "@bluelibs/runner/node";

const durable = resources.memoryWorkflow.fork("workflows");
const orderPlaced = r.event<{ orderId: string }>("orderPlaced")
  .tags([tags.durableEvent])
  .build();
const recordOrder = r.hook("recordOrder").on(orderPlaced)
  .run(async (event) => ({ orderId: event.data.orderId }))
  .build();
const placeOrder = r.task("placeOrder").dependencies({ emit: orderPlaced })
  .run(async (input: { orderId: string }, { emit }) => { await emit(input); })
  .build();
const app = r.resource("app").register([
  resources.durable,
  durable.with({
    persist: { filePath: "./workflow-state.json" },
    recovery: { onStartup: true },
  }),
  resources.durableEventBridge,
  orderPlaced, recordOrder, placeOrder,
]).build();

const runtime = await run(app);
try {
  await runtime.runTask(placeOrder, { orderId: "order-123" });
} finally {
  await runtime.dispose();
}
```

Use a persistent backend for recovery after process loss. Memory-only resources still checkpoint steps for the lifetime of their instance. File persistence supports one process; Redis supports shared workflow state. Queue deployments need an active consumer.

## Select Events And Backends

The bare tag selects an event and discovers the one visible durable resource. Multiple visible resources require a bridge default or an event override. Resource references are definitions, not instances or string names.

These partial examples assume the referenced events, resources, and domain tag are registered:

```ts
resources.durableEventBridge.with({
  defaultDurable: durable,
  applyTo: "all",
  retention: { onComplete: "delete" },
});

// Alternative selectors:
resources.durableEventBridge.with({ applyTo: [orderPlaced, invoiceIssued] });
resources.durableEventBridge.with({ applyTo: (event) => critical.exists(event) });

// Event-level overrides:
.tags([tags.durableEvent.with({ durable: paymentsDurable })])
.tags([tags.durableEvent.with({ enabled: false })])
```

An opt-out wins over broad selection. Otherwise a tag selects the event independently of the selector. Event backend overrides win over the bridge default. Ambiguous or unavailable resources fail startup. Register one bridge per runtime. Lifecycle and durable audit events are excluded from broad selection to prevent recursive workflow creation.

Durable emissions enforce fail-fast errors after retries; aggregate mode and `throwOnError: false` are rejected. Reporting successful completion with `report: true` remains supported.

Selection runs once against registered definitions at bootstrap. Every public emission path, including EventManager emission, uses the dispatch bridge. Emission interceptors still run; participating hooks retain dependency injection, admission, execution interceptors, and tracing.

Emit durable events after resource initialization, from tasks or ready hooks. A selected event cannot also belong to a remote event/RPC lane. The first version supports sequential, named exact-event hooks. Global/selector hooks, anonymous listeners, parallel execution, payload mutation, propagation control, and nested durable emissions from a hook body are rejected. Hook bodies should contain bounded external operations; put signal waits and complex orchestration in ordinary workflow tasks.

## Automatic Identity And Parent Workflows

Each top-level emission gets a fresh execution identity. Identical payloads remain independent emissions. No request key is required.

Inside a workflow, emission automatically sets `parentExecutionId` to the emitting execution, including when the event routes to another durable resource. Submission is checkpointed and deduplicated: replay reuses the same child rather than creating another workflow.

An injected event dependency accepts an explicit call-site ID:

```ts
await orderPlaced(payload, { stepId: "placeOrder" });
```

Without `stepId`, call order determines the identity and the parent workflow's implicit-step determinism policy applies. Use explicit IDs when refactoring long-lived workflows. Same-backend parents use durable execution waiters; cross-backend parents wait through the child's resource and reuse the saved child ID after recovery.

An optional `idempotencyKey` emission option deduplicates external retries within that event's identity. It is useful when a caller loses its response and submits again. Automatically generated identities cannot recognize independent calls as the same business operation.

Aborting the caller's wait leaves accepted work running. Explicitly cancel the execution to request durable cancellation. Shutdown and pause park attempts for recovery.

## Compensate Hooks

Compensation is optional and independent of durability. To require it, configure the event with `tags.durableEvent.with({ compensation: "required" })`. Every participating hook must then declare `.compensate(...)`.

Partial example assuming a registered inventory resource:

```ts
const reserveStock = r.hook("reserveStock").on(orderPlaced)
  .dependencies({ inventory })
  .run(async (event, { inventory }) => inventory.reserve(event.data.orderId, {
    idempotencyKey: event.durable!.stepKey,
  }))
  .compensate(async (receipt, event, { inventory }) => {
    await inventory.release(receipt.reservationId, {
      idempotencyKey: event.durable!.compensationKey,
    });
  })
  .build();
```

The receipt is inferred from `run` and persisted. `event.durable` exposes the execution ID and separate stable keys for forward and reverse operations. It is optional in the portable event type because bridge policy is configured at runtime.

On exhausted forward retries, the workflow persists its failure phase, attempts compensation in reverse order, and checkpoints each undo. Compensation continues after individual undo failures. `compensation_failed` executions remain inspectable; `durable.operator.retryRollback(id)` followed by recovery retries outstanding undos without rerunning forward hooks. Explicit cancellation uses the same recoverable compensation path.

Existing `.transactional()` events return undo closures; migrate them to registered compensation before selecting them for durable execution. External effects are at least once around a crash before their receipt is persisted. Use the operation keys with an idempotent downstream API or reconcile partial effects.

## Deployment And Retention

Each execution saves its ordered hook membership. Recovery uses that saved plan: completed hooks reuse their receipts, and unfinished hooks run their currently deployed implementations. Added hooks participate only in new emissions; changing hook order does not reorder existing executions. There is no event version setting.

Keep saved hooks registered for their original event until executions settle. Missing or retargeted saved hooks reject recovery before further effects, including compensation. Backend routing and compensation policy must also remain compatible. Current hook implementations must accept persisted event payloads; current compensation handlers must accept receipts produced by older implementations. Changing a completed hook does not rerun it, but changing its compensation handler affects outstanding undo work.

Event retention overrides bridge retention, which overrides the durable resource default. [Successful history collection](DURABLE_RETENTION.md) removes bulky completed history while preserving completion results. Failed and compensation-failed workflows retain their history.

The bridge uses Runner's serializer resource to validate payloads and receipts. Custom serialized types must be registered there as well as supported by the durable backend's serializer. Ordinary `durableContext.emit()` continues to publish durable bus notifications; use injected Runner event dependencies to trigger this bridge.
