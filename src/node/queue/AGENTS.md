# Shared Node Queue Machinery

## Scope And Maintenance

This folder supplies transport infrastructure used by `../durable/queue/`
and `../event-lanes/`. Domain retry, poison-message, and cooldown policy stays in those adapters.

If you make changes within this directory, update this AGENTS.md in the same change to reflect affected responsibilities, entry points, contracts, and tests. Keep it concise and accurate; avoid artificial edits when guidance is unchanged.

## Entry Points

- `BaseMemoryQueue.ts`: queue/in-flight maps and a sequential delivery loop with policy hooks.
- `rabbitmq/RabbitMQTransport.ts`: channels, publishers, consumers, reconnect, and settlement.
- `rabbitmq/RabbitMQTransport.types.ts`: minimal AMQP contracts and queue/dead-letter options.
- `rabbitmq/createConsumeHandler.ts`: decode/identify/deliver boundary and malformed-message settlement.
- `../durable/optionalDeps/amqplib.ts`: lazy AMQP connection loading.

## Delivery Contracts

- Memory queue state belongs to the instance; keep pending and in-flight messages distinct.
- Message ids are generated delivery identities, not canonical task/event or workflow ids.
- Delivery increments attempts; requeue and handler-error policy are overridable by each domain adapter.
- Preserve sequential memory processing and scheduling after enqueue/ack/nack.
- RabbitMQ message mapping connects a domain delivery id to the actual channel delivery.
- Invalid payloads or missing ids are nacked without requeue; throwing handlers also settle without requeue.
- Successful handlers own ack/nack through the adapter; do not acknowledge before durable work commits.
- Publishing waits for confirms when enabled and supported; keep persistent-message defaults.
- Preserve active/passive assertion, dead-letter, quorum, TTL, and prefetch options.
- Reconnection coalesces recovery work and reinstalls the active consumer handler.
- Connection generations ignore stale disconnect callbacks, especially after disposal.
- Canceling a consumer clears the active handler so recovery cannot resurrect it.
- Disposal invalidates the generation, cancels the consumer, clears delivery mapping, and closes transport.
- Logging failures must not break queue settlement/recovery.

## Tests And Acceptance

Mirrored tests are in `../__tests__/queue/`.
`BaseMemoryQueue.test.ts` covers the reusable memory loop;
`rabbitmq/RabbitMQTransport.mock.test.ts` and
`rabbitmq/RabbitMQTransport.resilience.mock.test.ts` cover lifecycle and recovery.
Changes here affect both durable and event lanes: also run their relevant queue
suites, particularly settlement, cooldown, and poison/retry tests, before root QA.
