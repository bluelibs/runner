# Runner Remote Lanes

<- [Back to main README](../README.md) | [Full guide](./FULL_GUIDE.md)

---

`Remote Lanes` unify distributed routing in Runner v6:

- **Event Lanes**: async, queue-backed event delivery
- **RPC Lanes**: sync RPC calls for lane-assigned tasks/events

Both are lane-based, topology-driven, and container/resource-aware.

## Mental Model

1. Choose lane assignment style per definition:
   - inversion-of-control via tags:
     - `globals.tags.eventLane` for async event transport
     - `globals.tags.rpcLane` for sync RPC transport
   - lane-driven via builder assignment:
     - `r.eventLane("...").applyTo([eventOrId])`
     - `r.rpcLane("...").applyTo([taskOrEventOrId])`
2. Define topology once.
3. Register lane runtime resources in Node with `profile` and optional `mode`.

## Core Guard Rails

- Event definitions cannot be tagged with both `eventLane` and `rpcLane`.
- Event definitions cannot be assigned to both lane systems (`eventLane` + `rpcLane`) across tags and/or `applyTo`.
- A definition cannot be assigned to two different lanes of the same lane system.
- `applyTo` string targets are runtime-validated against container definitions and fail fast on invalid type/id.
- `transactional + globals.tags.eventLane` is invalid.
- `transactional + parallel` is invalid.
- For RPC Lanes in `mode: "network"`, each served/assigned lane must be bound to a communicator.

## Modes (Mode-First)

`mode` is authoritative and sits above topology/profile routing.

- `"network"` (default): normal remote-lane behavior.
- `"transparent"`: bypass lane transport and execute locally.
- `"local-simulated"`: local in-memory transport simulation with serializer boundary.

### Mode behavior summary

- In `transparent` / `local-simulated`, profile routing (`serve`/`consume`) is ignored.
- Only `network` uses profile-based lane routing decisions.
- In `transparent` / `local-simulated`, lane transport dependencies (queues/communicators) are not required to resolve.

## Event Lanes (Async)

Use Event Lanes for fire-and-forget queue semantics and decoupled worker consumption.

### Quick Start

```typescript
import { globals, r } from "@bluelibs/runner";
import {
  eventLanesResource,
  MemoryEventLaneQueue,
} from "@bluelibs/runner/node";

const notificationsLane = r.eventLane("app.lanes.notifications").build();
// Alternative non-IoC assignment:
// const notificationsLane = r
//   .eventLane("app.lanes.notifications")
//   .applyTo(["app.events.notificationRequested"])
//   .build();
const notificationsQueue = r
  .resource("app.resources.notificationsQueue")
  .init(async () => new MemoryEventLaneQueue())
  .dispose(async (queue) => {
    await queue.dispose?.();
  })
  .build();

const notificationRequested = r
  .event<{ userId: string; channel: "email" | "sms" }>(
    "app.events.notificationRequested",
  )
  .tags([globals.tags.eventLane.with({ lane: notificationsLane })])
  .build();

const sendNotification = r
  .hook("app.hooks.sendNotification")
  .on(notificationRequested)
  .run(async (event) => {
    await deliverNotification(event.data);
  })
  .build();

const Profiles = {
  NotificationsWorker: "worker.notifications",
} as const;

const topology = r.eventLane.topology({
  profiles: {
    [Profiles.NotificationsWorker]: {
      consume: [notificationsLane],
    },
  },
  bindings: [
    {
      lane: notificationsLane,
      queue: notificationsQueue,
      prefetch: 8,
    },
  ],
});

const app = r
  .resource("app")
  .register([
    notificationRequested,
    sendNotification,
    notificationsQueue,
    eventLanesResource.with({
      profile: Profiles.NotificationsWorker,
      topology,
      mode: "network", // default
    }),
  ])
  .build();
```

### Topology contract

- Lane definition: `r.eventLane("...").applyTo([...])?.build()`
- Event tagging: `globals.tags.eventLane.with({ lane, orderingKey?, metadata? })`
- Topology: `r.eventLane.topology({ profiles, bindings })`
  - `profiles[profile].consume`: lanes consumed by this runtime
  - `bindings[]`: `lane -> queue` (resource or instance), optional `prefetch` and `dlq`
- Runtime resource: `eventLanesResource.with({ profile, topology, mode? })`

### Runtime routing

- `network`: lane-assigned emits (tag or `applyTo`) are intercepted and enqueued; consumers relay from queue.
- `transparent`: lane transport bypassed; lane-assigned events run local pipeline.
- `local-simulated`: lane-assigned emits go through in-memory relay path with serializer boundary.

### Lifecycle integration

- In `mode: "network"`, consumer workers attach on `globals.events.ready`.
- Queue `prefetch` is resolved before network consumers start.
- On shutdown (`globals.events.disposing`), queues enter cooldown before final disposal.

### Queue adapters

- Built-in: `MemoryEventLaneQueue`, `RabbitMQEventLaneQueue`
- Custom: implement `IEventLaneQueue` (`enqueue`, `consume`, `ack`, `nack`, optional `setPrefetch`, `init`, `dispose`)

### RabbitMQ example

```typescript
import { globals, r } from "@bluelibs/runner";
import {
  eventLanesResource,
  RabbitMQEventLaneQueue,
} from "@bluelibs/runner/node";

const notificationsLane = r.eventLane("app.lanes.notifications").build();

const notificationsQueue = r
  .resource("app.resources.notificationsQueue")
  .init(
    async () =>
      new RabbitMQEventLaneQueue({
        url: process.env.RABBITMQ_URL,
        queue: {
          name: "runner.notifications",
          durable: true,
          assert: "active",
          quorum: true,
          deadLetter: {
            queue: "runner.notifications.dlq",
            exchange: "",
            routingKey: "runner.notifications.dlq",
          },
          messageTtl: 60_000,
          arguments: {
            "x-max-length": 10_000,
          },
        },
        prefetch: 16,
        publishOptions: {
          persistent: true,
        },
      }),
  )
  .dispose(async (queue) => {
    await queue.dispose();
  })
  .build();

const topology = r.eventLane.topology({
  profiles: {
    api: { consume: [] },
    worker: { consume: [notificationsLane] },
  },
  bindings: [{ lane: notificationsLane, queue: notificationsQueue }],
});

const app = r
  .resource("app")
  .register([
    notificationsQueue,
    eventLanesResource.with({
      profile: process.env.RUNNER_PROFILE || "worker",
      topology,
    }),
  ])
  .build();
```

## RPC Lanes (Sync)

Use RPC Lanes when one Runner must call another Runner and wait for a result.

### Quick Start

```typescript
import { globals, r } from "@bluelibs/runner";
import { rpcLanesResource } from "@bluelibs/runner/node";

const billingLane = r.rpcLane("app.rpc.billing").build();
// Alternative non-IoC assignment:
// const billingLane = r
//   .rpcLane("app.rpc.billing")
//   .applyTo(["billing.tasks.chargeCard"])
//   .build();

const chargeCard = r
  .task("billing.tasks.chargeCard")
  .tags([globals.tags.rpcLane.with({ lane: billingLane })])
  .run(async (input: { amount: number }) => ({ ok: true, amount: input.amount }))
  .build();

const billingCommunicator = r
  .resource("app.resources.billingCommunicator")
  .init(
    r.rpcLane.httpClient({
      client: "mixed", // "fetch" | "mixed" | "smart"
      baseUrl: process.env.BILLING_RPC_URL as string,
      auth: { token: process.env.RUNNER_RPC_TOKEN as string },
    }),
  )
  .build();

const topology = r.rpcLane.topology({
  profiles: {
    api: { serve: [] },
    billing: { serve: [billingLane] },
  },
  bindings: [{ lane: billingLane, communicator: billingCommunicator }],
});

const app = r
  .resource("app")
  .register([
    chargeCard,
    billingCommunicator,
    rpcLanesResource.with({
      profile: "api",
      topology,
      mode: "network", // default
      exposure: {
        http: {
          basePath: "/__runner",
          listen: { port: 7070 },
          auth: { token: process.env.RUNNER_RPC_TOKEN as string },
        },
      },
    }),
  ])
  .build();
```

### Topology contract

- Lane definition: `r.rpcLane("...").applyTo([...])?.build()`
- Tag tasks/events: `globals.tags.rpcLane.with({ lane })`
- Topology: `r.rpcLane.topology({ profiles, bindings })`
  - `profiles[profile].serve`: lanes served locally by this runtime
  - `bindings[]`: `lane -> communicator resource`, optional `allowAsyncContext`
- Runtime resource: `rpcLanesResource.with({ profile, topology, mode?, exposure? })`
  - `exposure.http` is supported only in `mode: "network"` and fails fast otherwise.

### Communicator contract

- `task(id, input?) => Promise<unknown>` (required for task RPC)
- `event(id, payload?) => Promise<void>` (optional)
- `eventWithResult(id, payload?) => Promise<unknown>` (optional)

### RPC routing

For lane-assigned tasks/events (tag or `applyTo`) in `mode: "network"`:

- lane in active profile `serve` => execute/emit locally
- lane outside active profile `serve` => route remotely via lane binding communicator

For non-lane-assigned tasks/events:

- unchanged local behavior

Mode overrides:

- `transparent`: bypass lane transport and execute locally
- `local-simulated`: local serializer roundtrip simulation for lane-assigned task/event flow

### HTTP communicator helper

`r.rpcLane.httpClient({ ... })` wraps existing HTTP clients with lane-friendly presets:

- `fetch` -> `createHttpClient` (universal)
- `mixed` -> `createHttpMixedClient` (Node)
- `smart` -> `createHttpSmartClient` (Node)

## Exposure and Allow-List

`rpcLanesResource` derives exposure allow-list from active `profile.serve` lanes plus lane-assigned tasks/events.

In `mode: "network"`, `exposure.http` starts/stops Node exposure with the resource lifecycle and remains fail-closed by default (configure `http.auth`).

## Event Lanes vs RPC Lanes

- **Event Lanes**: async queue delivery for lane-assigned events.
- **RPC Lanes**: sync remote call semantics for lane-assigned tasks/events.
- Common pattern: command via RPC Lane, then domain projection via Event Lane.

## Migration Note (v6)

Legacy tunnel event routing (`events` + `emit` + `eventDeliveryMode`) is removed.

- Use Event Lanes for async event transport.
- Use RPC Lanes for sync task/event RPC.

## HTTP Wire Policy

Transport/wire details are documented in:

- [TUNNEL_HTTP_POLICY.md](./TUNNEL_HTTP_POLICY.md)

This policy applies to HTTP RPC communicators used by RPC Lanes in `mode: "network"`.

## Security Notes

- Remote lane servers are intended for trusted network boundaries.
- Always configure `http.auth` and infrastructure protections (gateway/rate-limits/network policy).
- Keep anonymous exposure disabled unless explicitly needed.
