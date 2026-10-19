# Durable Event Bridge

> **Implementation:** See [DURABLE_EVENTS.md](DURABLE_EVENTS.md) for the implemented contract and current limitations. This document retains the broader design proposal.

> **Status: Design proposal.** The implementation guide linked above is authoritative for available APIs and behavior. This proposal also describes deferred capabilities.

The durable event bridge turns an event emission into one durable workflow and each participating hook into a checkpointed step. Applications keep emitting their typed events through dependency injection. A bridge resource selects which events use durable execution and which durable resource owns each execution.

This is Node-only integration. Ordinary events retain their current behavior unless selected. A selected event requires a persistent backend to survive process loss; an in-memory backend alone cannot provide that guarantee.

## Tag An Event

Proposed setup using the existing memory workflow resource with file persistence. `tags.durableEvent` and `resources.durableEventBridge` are new surfaces; this example will become runnable when they are implemented.

```ts
import { r, run } from "@bluelibs/runner";
import { resources, tags } from "@bluelibs/runner/node";

const durable = resources.memoryWorkflow.fork("workflows");

const orderPlaced = r
  .event<{ orderId: string }>("orderPlaced")
  .tags([tags.durableEvent])
  .build();

const recordOrder = r
  .hook("recordOrder")
  .on(orderPlaced)
  .run(async (event) => {
    // Replace with an idempotent operation using event.durable.stepKey.
    return { orderId: event.data.orderId };
  })
  .build();

const placeOrder = r
  .task("placeOrder")
  .dependencies({ orderPlaced })
  .run(async (input: { orderId: string }, { orderPlaced }) => {
    await orderPlaced(input);
  })
  .build();

const app = r
  .resource("app")
  .register([
    resources.durable,
    durable.with({
      persist: { filePath: "./workflow-state.json" },
      recovery: { onStartup: true },
      polling: { enabled: true },
    }),
    resources.durableEventBridge,
    orderPlaced,
    recordOrder,
    placeOrder,
  ])
  .build();

const runtime = await run(app);
try {
  await runtime.runTask(placeOrder, { orderId: "order-123" });
} finally {
  await runtime.dispose();
}
```

The bridge discovers the one visible durable resource during bootstrap. The emitter waits for execution completion, including when the resource uses a queue. No request key is required. Queue-backed deployments must have an active consumer; the bridge does not enable consumption implicitly.

## Select Events Centrally

Use the bridge resource for application policy, and event tags for local declarations. These are configuration alternatives, not registrations to combine in one app.

```ts
// Only explicitly tagged events. This is the default.
resources.durableEventBridge.with({ defaultDurable: durable });

// Every eligible application event.
resources.durableEventBridge.with({
  defaultDurable: durable,
  applyTo: "all",
});

// Specific definitions.
resources.durableEventBridge.with({
  defaultDurable: durable,
  applyTo: [orderPlaced, invoiceIssued],
});

// Events carrying a domain tag. Assumes criticalEvent is a tag definition.
resources.durableEventBridge.with({
  defaultDurable: durable,
  applyTo: (event) => criticalEvent.exists(event),
});
```

Predicates inspect definitions once during bootstrap, after overrides and canonical ownership are resolved. They do not inspect payloads. The selection is fixed for that runtime.

| Configuration Location | Assessment |
| --- | --- |
| Bridge resource with `applyTo` | Recommended: one visible routing policy, familiar selection vocabulary, no competing claims between durable resources. |
| Event tag only | Good default for a few important events; repetitive for application-wide policy. |
| Selector on every durable resource | Avoid: multiple resources can silently compete for the same event. |
| Global `run()` option | Avoid: backend references and selection policy belong in the registered graph. |

`"all"` means eligible application events. Framework lifecycle, durable audit, bridge-internal, and other infrastructure events are excluded by definition identity. Durable audit events must never recursively create their own workflows. Explicitly tagging an ineligible infrastructure event fails bootstrap. An eligible event with incompatible hooks also fails bootstrap; it is not silently skipped.

## Select A Durable Resource

Partial examples assume `paymentsDurable` and `analyticsDurable` are registered workflow resource definitions.

```ts
// Most applications need only the bare tag.
.tags([tags.durableEvent])

// Route this event to a particular registered resource.
.tags([tags.durableEvent.with({ durable: paymentsDurable })])

// Override a broad bridge selector for one event.
.tags([tags.durableEvent.with({ enabled: false })])
```

Selection and routing follow these rules:

1. `enabled: false` opts out, including from `applyTo: "all"`.
2. A bare or enabled tag selects the event; otherwise `applyTo` decides.
3. The event's explicit `durable` wins over `defaultDurable`.
4. Without either reference, discover exactly one durable resource visible to the bridge and permitted by Runner's graph rules.
5. Zero candidates or multiple candidates fail bootstrap with the affected event and candidate identities. Registration order never chooses a backend.

Resource references are bare definitions, not resource values or string names. Routing respects visibility and is isolated per `run(app)`. Allow one bridge policy resource per runtime in the first version. Two registrations must fail rather than intercept an emission twice.

Tagged definitions without a registered bridge fail bootstrap. A selected event cannot fall back to ordinary execution when its backend is unavailable.

## Emission And Automatic Identity

The injected emitter keeps its normal wait-for-hooks behavior. Selected emissions persist their input and compiled plan before any hook side effects. Backend admission failures reject the call. Business failures reject after the configured retries and, when enabled, compensation.

Emitting the event is the durable workflow trigger. The caller uses its normal injected event dependency and does not need a durable-resource dependency or a separate workflow-start API:

```ts
await orderPlaced({ orderId: "order-123" });
```

The bridge resolves the configured durable resource, creates the execution, and dispatches the hooks through that execution. All public Runner emission paths use this routing decision, including low-level event-manager emission; none may also dispatch the same hooks outside the workflow. Execution identities remain available to tracing and durable operator tooling without changing the ordinary emitter return contract.

Runner generates an emission identity before submission and preserves it through internal retries and delivery. Hook operation keys derive from that identity and the exact persisted hook identity; compensation has a separate key. They are exposed through `event.durable` only on durable emissions, with appropriate narrowing for broadly selected hooks.

Two independent calls with identical payloads create two emissions. Payload hashing would incorrectly merge legitimate repeated events. If an external client retries after losing the response, automatic identity alone cannot recognize that business duplicate. An optional explicit idempotency key remains available for that integration, but ordinary callers need not provide one.

Within an existing durable workflow, repeated replay of the same emission must reuse its identity. The bridge must memoize submission at a stable parent call site and persist the parent-child relationship before waiting. An explicit `stepId` option supports refactor-stable call sites; otherwise the existing implicit-step determinism policy applies. Nested emission from inside a running hook step is rejected initially rather than pretending arbitrary nested effects are replay-safe.

Once accepted, cancelling a caller's wait does not erase durable work. Before acceptance, abort prevents admission. After acceptance, cancelling the execution is a separate durable operation. Shutdown parks recoverable work; it does not turn all in-flight emissions into business failures.

## Durable Hooks And Compensation

Durability and compensation are independent. A durable event can retry and resume its hooks without promising to reverse them. Enable compensation when the whole event is a saga:

```ts
// Partial event definition.
.tags([
  tags.durableEvent.with({
    compensation: "required",
    retention: { onComplete: { afterMs: 86_400_000 } },
  }),
])
```

Proposed hook API; assumes the event above and an inventory resource:

```ts
const reserveStock = r
  .hook("reserveStock")
  .on(orderPlaced)
  .order(10)
  .dependencies({ inventory })
  .run(async (event, { inventory }) => {
    return inventory.reserve(event.data.orderId, {
      idempotencyKey: event.durable.stepKey,
    });
  })
  .compensate(async (receipt, event, { inventory }) => {
    await inventory.release(receipt.reservationId, {
      idempotencyKey: event.durable.compensationKey,
    });
  })
  .build();
```

The receipt type is inferred from `run`. Receipts and payloads must round-trip through the configured serializer. Functions and captured dependency instances are not receipts. Compensation is registered code, with dependencies resolved afresh after recovery.

Existing `.transactional()` hooks return undo closures. They remain supported for ordinary events; selecting such an event for the bridge fails until migrated to the separate compensation contract. Persisting a closure is not a recovery strategy.

## Execution Rules

- Persist the ordered plan, event timestamp, payload, source metadata, and persistence identities. Preserve Runner's stable hook ordering and source-aware eligibility. Do not flatten canonical identities to local names.
- Replay completed hooks from their receipts. Freeze plan membership for an execution; new deployments must not insert hooks into existing executions. Recovery resolves saved hook identities to current implementations and retains saved ordering. Added hooks apply only to new emissions. Missing or retargeted saved hooks fail before more side effects; payload and compensation receipt compatibility remains the application's responsibility.
- Exhaust forward retries before entering compensation. Persist that decision and the triggering error. Once compensation starts, forward execution never resumes in that execution.
- Compensate successful hooks in reverse order. Persist each undo result, attempt the remaining undos after an individual failure, and report the original error plus compensation errors. `retryRollback` retries only outstanding undos.
- A failed hook may have partially acted before throwing. Its external operation must be idempotent or reconcilable. Compensation of previously completed hooks cannot automatically repair it.
- Pauses, durable suspension, shutdown, and lost ownership are control flow, not business failures. Explicit execution cancellation requests compensation when required; it must leave incomplete compensation recoverable.
- Preserve hook DI, admission, tracing, and applicable execution interceptors through Runner's hook execution path. Do not call raw definitions to bypass these checks. Side effects in interceptors need the same retry discipline as hook bodies.

The first version runs hooks sequentially. Reject parallel events, event-lane assignments, global/selector hooks participating in selected events, dynamic anonymous listeners, payload mutation, propagation control, and durable waits inside hook bodies. Emit separate lifecycle notifications for broad observers. These restrictions apply even under `applyTo: "all"` and must be explained in startup diagnostics where statically detectable.

External effects and persisted receipts are not one atomic transaction. A crash between them can repeat the effect. Stable operation keys enable downstream idempotency; they do not create exactly-once guarantees for arbitrary services.

## Retention

Use the shared [successful-execution retention policy](DURABLE_RETENTION_PROPOSAL.md). It applies to ordinary workflows and bridged events alike. Event overrides win over bridge defaults, which win over durable-resource defaults. Without configuration, retain history.

```ts
resources.durableEventBridge.with({
  defaultDurable: durable,
  applyTo: "all",
  retention: { onComplete: "delete" },
});
```

This makes successful execution details eligible for collection as soon as completion is safely persisted. Failed and compensation-failed executions remain available for inspection and repair.

## Acceptance Criteria

- [ ] Bare tag with one visible durable resource works through an ordinary injected emitter.
- [ ] Explicit resource routing, bridge default, ambiguity, missing bridge, opt-out, and visibility are validated.
- [ ] Definition arrays, tag predicates, and all-event selection produce deterministic plans; infrastructure events cannot recurse.
- [ ] Automatic identities survive internal retry and parent replay; independent identical submissions remain distinct.
- [ ] Ordinary emission triggers exactly one durable execution through every public emission path, without requiring a separate start API or durable-resource dependency at the call site.
- [ ] Queue mode preserves wait-for-completion behavior without also dispatching hooks outside the workflow.
- [ ] Crashes before and after receipt persistence exercise operation-key deduplication and restart recovery.
- [ ] Compensation resumes after a crash, retains all errors, and never returns to forward execution.
- [ ] Deployment plan mismatches fail clearly; two runtimes do not share mutable bridge state.
- [ ] Immediate and delayed retention preserve waiting callers, replaying parents, and outstanding compensation.

## Implementation Boundaries

Add the bridge under `src/node/durable/`, with Node exports for its tag and resource. Extend portable hook definitions only for the typed compensation contract; portable event execution must not import the durable engine.

Compile plans during graph setup, and execute them using the existing durable task engine. Add durable compensation-phase recovery and retention to that engine rather than introducing a second scheduler or store. The current `durableContext.emit()` remains a bus notification; this proposal does not silently change it into Runner event dispatch.

Related existing contracts: [events and hooks](../guide-units/02c-events-and-hooks.md), [durable workflows](DURABLE_WORKFLOWS.md), and [durable core architecture](../src/node/durable/core/AGENTS.md).
