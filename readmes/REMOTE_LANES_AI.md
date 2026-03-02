# BlueLibs Runner: Remote Lanes AI Field Guide

## Event Lanes (Node)

Event Lanes route lane-assigned events to queues using explicit lane references.

- Runtime boundary: `eventLanesResource` attaches interception at runtime for lane-assigned emissions only; non-lane events keep normal local behavior.
- Define lanes with `r.eventLane("app.lanes.email").build()` (or `eventLane(...)`).
- Optional lane-side assignment: `r.eventLane("...").applyTo([eventOrId])`.
- Define topology with `r.eventLane.topology({ profiles, bindings })`.
- Boundary reminder: Event Lanes are async fire-and-forget queue routing; use RPC Lanes for synchronous task/event RPC (`readmes/REMOTE_LANES.md`).
- Tag events with `globals.tags.eventLane.with({ lane })`.
- Register `eventLanesResource` (from `@bluelibs/runner/node`) with:
  - `profile` + `topology` + optional `mode` (`"network"` | `"transparent"` | `"local-simulated"`)
  - `bindings: [{ lane, queue, auth?, prefetch?, maxAttempts?, retryDelayMs? }]` where `queue` can be a queue instance or a queue resource
- Use profile constants when desired:
  - `const Profiles = { API: "api", WORKER: "worker" } as const`
  - `profile: Profiles.API`
- `mode: "network"` (default):
  - Lane-assigned event emissions (tag or `applyTo`) are intercepted and enqueued to bound queues.
  - Active profile `consume` lanes start dequeue workers on `globals.events.ready`.
  - Payload is deserialized with `serializer.parse(...)`, then re-emitted in-process.
  - Auth readiness is role-based: consumed lanes require verifier material; non-consumed lanes require signer material.
  - In `jwt_asymmetric`, this enables producer-only private key and consumer-only public key setups.
- `mode: "transparent"`:
  - Lane transport is bypassed.
  - Lane-assigned events execute locally through the normal event pipeline.
- `mode: "local-simulated"`:
  - Lane-assigned events use an in-memory simulated relay path.
  - Payload crosses a serializer boundary (`stringify -> parse`) before local re-emit.
  - If `binding.auth` is configured, the simulated path also signs+verifies JWT lane tokens before relay emit.
  - In `jwt_asymmetric`, local-simulated must have both signer and verifier key material available.
- Local emulation options without extra services:
  - `transparent` for fastest feedback loops.
  - `local-simulated` for serializer-boundary simulation.
- Runtime guard rails:
  - lane ids must be non-empty strings (`defineEventLane`, `defineRpcLane`)
  - `applyTo` string ids are validated against container definitions and type (event only).
  - Event cannot be on two different `eventLane`s.
  - Event cannot be on both `eventLane` and `rpcLane` (via tags and/or `applyTo`).
  - Missing signer material fails fast (`runner.errors.remoteLanes.auth.signerMissing`) for producer roles.
  - Missing verifier material fails fast (`runner.errors.remoteLanes.auth.verifierMissing`) for consumer roles.
- In `transparent` and `local-simulated`, profile `consume` is ignored for routing decisions.
- Relay re-emits bypass lane interception to prevent loops.
- Hooks run based on event subscriptions after relay re-emit.
- When debug event emission logging is enabled (`logEventEmissionOnRun`), Event Lanes emits routing diagnostics: `event-lanes.enqueue`, `event-lanes.relay-emit`, and `event-lanes.skip-inactive-lane`.
- Consumer queue prefetch is resolved from lane binding `prefetch`.
- Event Lanes supports binding-level retry policy:
  - `maxAttempts` (default `1`) controls retry budget before final fail path.
  - `retryDelayMs` adds a delay before requeue retries.
- Final failure settles with `nack(false)`: dead-letter behavior is broker/queue-policy owned (Runner does not manually publish to DLQ).
- Multiple lanes can share one queue, but each lane can only have one binding.

Built-in queue adapters:

- `MemoryEventLaneQueue`
- `RabbitMQEventLaneQueue`

`RabbitMQEventLaneQueue` supports queue wiring options for common broker setups:

- All options are optional except `queue.name`.
- `queue.durable` (default `true`)
- `queue.assert` (`"active" | "passive"`, default `"active"`)
- `queue.arguments` (extra `assertQueue` arguments)
- `queue.deadLetter` (plain string shorthand like `"my.dlq"`, or `{ queue, exchange, routingKey }`)
- `publishOptions` (defaults to `{ persistent: true }`; message publish properties, intentionally separate from queue declaration settings)
- `publishConfirm` (default `true`; waits for broker confirms when available)
- `reconnect` (`{ enabled?, maxAttempts?, initialDelayMs?, maxDelayMs? }`; retry/recovery policy for connection/channel drops)

Custom backends implement `IEventLaneQueue` (`enqueue`, `consume`, `ack`, `nack`, optional `cooldown`, `setPrefetch`, `init`, `dispose`).

```ts
import { randomUUID } from "node:crypto";
import type {
  EventLaneMessage,
  EventLaneMessageHandler,
  IEventLaneQueue,
} from "@bluelibs/runner/node";

class CustomEventLaneQueue implements IEventLaneQueue {
  async enqueue(
    _message: Omit<EventLaneMessage, "id" | "createdAt" | "attempts">,
  ): Promise<string> {
    return randomUUID();
  }

  async consume(_handler: EventLaneMessageHandler): Promise<void> {}
  async ack(_messageId: string): Promise<void> {}
  async nack(_messageId: string, _requeue: boolean = true): Promise<void> {}
  async setPrefetch(_count: number): Promise<void> {}
}
```

## RPC Lanes (Node)

RPC Lanes route lane-assigned tasks/events across runners using profile/topology bindings.

- Runtime boundary: `rpcLanesResource` routes lane-assigned events via interception and lane-assigned tasks via runtime task decoration; non-lane flows remain unchanged.
- Define lanes with `r.rpcLane("app.lanes.billing").build()`.
- Lane async-context policy is lane-level: `r.rpcLane("...").asyncContexts([...])` (default is `[]`, so none are forwarded unless explicitly allowlisted).
- Optional lane-side assignment: `r.rpcLane("...").applyTo([taskOrEventOrId])`.
- Tag tasks/events with `globals.tags.rpcLane.with({ lane })`.
- Define topology with `r.rpcLane.topology({ profiles, bindings })`:
  - `profiles[profile].serve` selects lanes this runtime serves locally.
  - `bindings[]` maps `lane -> communicator resource` plus async-context policy and optional lane JWT material (`auth`).
- Register `rpcLanesResource` (from `@bluelibs/runner/node`) with:
  - `profile` + `topology` + optional `mode` (`"network"` | `"transparent"` | `"local-simulated"`) + optional `exposure.http`.
- Exposure `http.auth` and lane JWT auth are separate:
  - `exposure.http.auth` gates HTTP endpoint access.
  - `binding.auth` gates lane authorization for task/event execution.
- Communicator resources are container-aware and can use:
  - `init(r.rpcLane.httpClient({ client: "fetch" | "mixed" | "smart", ... }))`
  - `fetch` is universal (`createHttpClient`)
  - `mixed` / `smart` are Node presets.
- Routing behavior in `mode: "network"`:
  - Lane in `serve` -> task/event executes locally.
  - Lane not in `serve` -> task/event routes remotely via communicator.
  - Every assigned or served lane must have a communicator binding.
- Mode overrides:
  - `transparent`: lane-assigned tasks/events execute locally (no lane transport).
  - `local-simulated`: lane-assigned tasks/events go through a local serializer roundtrip simulation and still enforce lane JWT when `binding.auth` is enabled.
  - In `jwt_asymmetric`, `local-simulated` requires both signer and verifier key material (same runtime signs and verifies).
- Local emulation options:
  - `transparent` for pure local smoke tests.
  - `local-simulated` for local transport-shape simulation.
- In `transparent` and `local-simulated`, profile `serve` is ignored for routing decisions.
- Exposure behavior:
  - HTTP exposure starts only when the active profile serves at least one lane.
  - `serve` lanes derive server allow-list automatically for lane-assigned tasks/events.
  - Auth remains fail-closed unless explicitly configured otherwise.
  - Lane JWT authorization is validated per served lane before task/event execution.
- Runtime guard rails:
  - `applyTo` string ids are validated against container definitions and type (task/event).
  - Task/event cannot be on two different `rpcLane`s.
  - Missing signer material fails fast (`runner.errors.remoteLanes.auth.signerMissing`).
  - Missing verifier material fails fast (`runner.errors.remoteLanes.auth.verifierMissing`).

## HTTP RPC Transport

HTTP RPC transport is used by RPC Lane communicators (`fetch`, `mixed`, `smart`) and keeps RPC capabilities intact:

- JSON payloads
- multipart uploads
- octet-stream/duplex paths (Node smart/mixed)
- typed error rethrow via `errorRegistry`
- async-context header propagation (policy-controlled per rpc lane binding)
- request-id/correlation headers and discovery endpoints
- event return payload support (`eventWithResult`)
