# Event Lane Runtime

## Maintenance

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Responsibility

Queue-backed event routing, relay execution, hook isolation, async-context transfer,
auth, and retry settlement. Queue adapters implement the local `IEventLaneQueue`
contract; generic event/hook execution stays in the core EventManager.

## Start Here

- [eventLanes.resource.ts](eventLanes.resource.ts) and
  [EventLanesController.ts](EventLanesController.ts): runtime/lifecycle orchestration.
- [EventLaneAssignments.ts](EventLaneAssignments.ts) and
  [EventLanesInternals.ts](EventLanesInternals.ts): assignments, profiles/bindings/state.
- [eventLanes.producer.ts](eventLanes.producer.ts) and
  [eventLanes.consumer.ts](eventLanes.consumer.ts): enqueue and relay/ack paths.
- [eventLanes.relayInterceptors.ts](eventLanes.relayInterceptors.ts): hook filtering.
- [eventLanes.asyncContext.ts](eventLanes.asyncContext.ts) and
  [eventLanes.auth.ts](eventLanes.auth.ts): lane boundary propagation/authentication.
- [EventLanesFailureHandler.ts](EventLanesFailureHandler.ts): retry/final nack decisions.
- [types.ts](types.ts), [MemoryEventLaneQueue.ts](MemoryEventLaneQueue.ts), and
  [RabbitMQEventLaneQueue.ts](RabbitMQEventLaneQueue.ts): queue contracts/adapters.

## Contracts To Preserve

- Assignment maps use canonical event ids; hook allowlists use registered hook ids.
  Queue message ids and lane ids are separate identities. Keep punctuation intact,
  including colons when decoding relay sources.
- An event cannot belong to both RPC/event lanes; transactional events cannot be
  assigned to event lanes. Validate routes/profile bindings before consuming.
- A profile consuming a shared queue must consume all lanes bound to that queue.
  Start consumers on runtime ready after prefetch policies have been applied.
- Network mode uses queues; transparent mode stays local; local-simulated mode
  exercises serialization/context/auth and hook isolation without network queues.
- Relay emissions must not enqueue themselves again. Only the configured relay
  hooks run, with the lane's selected async contexts available through hook execution.
- Ack after successful relay. Auth, unknown-event, assignment, and malformed-payload
  failures are permanent; retryable failures requeue within the binding attempt budget.
  Final nack delegates dead-letter behavior to the queue/broker.
- RabbitMQ retries preserve correlation ids but settle independent broker deliveries in their handler scope; stale handlers cannot settle redeliveries. Enqueue/relay diagnostics include the same messageId.
- Cooldown stops intake/requeues late deliveries; dispose tears down managed queues.
  Resource-backed queues retain their resource-owned lifecycle.

## Tests And Further Reading

- [Event lane tests](../__tests__/event-lanes): queue adapters, modes, auth, context,
  poison messages, retries, shared queues, and hook filtering including colon ids.
- [Shared queue topology](../__tests__/event-lanes/eventLanes.shared-queue-topology.integration.test.ts).
- [Remote Lanes guide](../../../readmes/REMOTE_LANES.md).
