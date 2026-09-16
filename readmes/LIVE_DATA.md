# Live Data

← [Back to main README](../README.md)

Live Data keeps a read task's result up to date. Subscribers receive an initial snapshot and new snapshots after relevant changes. A Mongo adapter creates the read task and its subscription binding from a normal Mongo query.

The implementation is Node-only. Start with the [runnable Mongo example](../examples/live-data-mongo/README.md): it demonstrates a subscription and a write, first in memory and then through Redis between two runtimes.

## A Mongo Query

Given a registered `messagesCollection` resource returning a typed Mongo collection:

```ts
import { live, Match, resources } from "@bluelibs/runner/node";

const messages = live.mongo({
  collection: messagesCollection,
  key: "chat.messages",
});

const threadMessages = messages.find("threadMessages", {
  inputSchema: { threadId: Match.NonEmptyString },
  query: ({ threadId }) => ({
    filter: { threadId },
    sort: { createdAt: 1, _id: 1 },
    limit: 20,
  }),
});
```

Register the collection resource, `threadMessages.task`, and `resources.liveData.with({ queries: [threadMessages] })` in your app. The generated task remains available for ordinary reads:

```ts
const current = await runtime.runTask(threadMessages.task, { threadId });

const liveData = runtime.getResourceValue(resources.liveData);
const subscription = await liveData.subscribe(
  threadMessages,
  { threadId },
  { signal },
);

for await (const frame of subscription) {
  if (frame.type === "snapshot") {
    renderMessages(frame.data);
  } else {
    showStaleState();
  }
}
```

The last snippet assumes your runtime, thread id, abort signal, and presentation functions. Transport adapters authenticate users, allowlist exposed queries, and cancel subscriptions when clients disconnect.

## Publish After A Write

Inside a task that depends on the collection and live-data resources, write using the injected native collection, then invalidate its source topic:

```ts
await messagesCollection.insertOne(message);
await liveData.invalidate(messages.topic());
```

For transactional writes, invalidate only after commit. `invalidate()` accepts one topic or an array of topics. It publishes through the configured provider, whose subscribers schedule fresh reads; it does not wait for consumers to receive updated results.

A database commit and a Pub/Sub publication are separate operations. A failed publication rejects and cannot undo a committed write. Use an outbox or a database change-feed bridge when you need to recover that gap. Raw writes made elsewhere require explicit invalidation or periodic revalidation.

The initial Mongo adapter observes a source-wide topic and reruns the query. It preserves filtering, projection, ordering, and limits without implementing a separate Mongo matcher. There is no automatic write interception, change-stream consumer, document patching, or join discovery.

## Find, Find One, And Count

`source.find(name, config)` returns a list. `source.findOne(name, config)` returns a document or `null`. `source.count(name, config)` uses `countDocuments` and returns a number.

For example, continuing with the same source:

```ts
const messageCount = messages.count("messageCount", {
  inputSchema: { threadId: Match.NonEmptyString },
  query: ({ threadId }) => ({ filter: { threadId } }),
});
```

Register each generated `.task` and list its binding in `queries`. Choose a stable source `key` shared by processes accessing the same logical data source. This application-defined key is distinct from Runner's canonical task identity.

Use a unique tie-breaker such as `_id` in sorted, limited queries. A document moving into or out of a result window is handled by rerunning the query. Projection results must be treated as projected values, not complete documents.

### Mongo ObjectIds

The minimal example uses string ids. If your query input or result contains Mongo `ObjectId` values, register a codec on the runtime serializer during bootstrap:

```ts
import { ObjectId } from "mongodb";
import { r, resources } from "@bluelibs/runner/node";

const mongoTypes = r
  .resource("mongoTypes")
  .dependencies({ serializer: resources.serializer })
  .init(async (_config, { serializer }) => {
    serializer.addType({
      id: "MongoObjectId",
      is: (value: unknown): value is ObjectId => value instanceof ObjectId,
      serialize: (value) => value.toHexString(),
      deserialize: (value: string) => new ObjectId(value),
    });
  })
  .build();
```

Register `mongoTypes` in your app before starting subscriptions after `run(app)` resolves. The codec preserves `ObjectId` instances through input capture and independent result snapshots. Register codecs for any other BSON-specific values you use as well.

## Scope Reads To The Current User

Define a mandatory server-side scope on the source:

```ts
import { asyncContexts, live } from "@bluelibs/runner/node";

const messages = live.mongo({
  collection: messagesCollection,
  key: "chat.messages",
  scope: () => ({
    tenantId: asyncContexts.identity.use().tenantId,
  }),
});
```

Every initial read and refresh combines this scope with the requested filter using `$and`. A requested filter cannot overwrite the scope. The active runtime identity is captured when subscribing and restored for background reads. Read tasks remain responsible for current authorization and field visibility.

Scope constrains database reads; the source topic stays the same across subscribers. Deriving a publication topic from arbitrary user permissions could prevent a write by one user from notifying another authorized user.

Construct queries from validated application input. Do not expose unrestricted Mongo selectors or projection options directly to an untrusted client. Changes to permissions also need an invalidation or subscription termination; a captured identity does not make old authorization decisions permanent.

## Redis Pub/Sub

The default provider is in memory and isolated to one `run()` instance. Redis uses the same provider-resource configuration pattern as caching:

```ts
import { resources } from "@bluelibs/runner/node";

resources.liveData.with({
  queries: [threadMessages],
  provider: resources.redisLiveDataProvider.with({
    redis: "redis://localhost:6379",
    prefix: "chat:production:live",
  }),
});
```

The configured provider is registered automatically. `redis` accepts a connection string or a compatible Redis client. A supplied client remains owned by its caller; the provider owns subscriber connections it duplicates and clients it creates itself.

An omitted prefix isolates the provider to one runtime. Give cooperating processes the same explicit prefix, and separate applications/environments with different prefixes. Redis distributes notifications to all interested servers; observer state and client connections remain local to each runtime.

When disconnected, existing subscriptions emit `{ type: "stale", reason: "bus-disconnected" }`. Once topic subscriptions are restored, affected queries are read again and fresh snapshots clear that stale state. Redis Pub/Sub does not retain missed messages.

## Bind An Existing Task

Live Data also works without the Mongo adapter:

```ts
import { live } from "@bluelibs/runner/node";

const threadTopic = (threadId: string) =>
  live.topic("threads", threadId, "messages");

const threadMessages = live.query({
  task: listMessages,
  topics: ({ threadId }) => [threadTopic(threadId)],
  batchWindowMs: 20,
  revalidateEveryMs: 30_000,
});
```

This partial example assumes a registered `listMessages` task. Topics are structured, exact-match keys. There is no wildcard or prefix matching. Declare all sources that can affect the result, including related data and authorization state.

The read task must be safe to repeat and return serializable data. Each read uses Runner's task pipeline, including middleware and validation. If the task uses a cache, arrange for fresh reads before publishing the live invalidation. Using Redis for both providers does not automatically connect cache invalidation and live invalidation.

## Subscription Rules

- `subscribe(query, input, { signal? })` resolves after the first read succeeds, with its initial snapshot buffered for the consumer.
- A snapshot has `{ type: "snapshot", revision, data }` and replaces the previous result. Revisions track an observer's snapshots; they are not database versions or replay cursors.
- Topic subscription happens before the initial read. Ordinary refreshes are serialized; invalidations during a read schedule another read.
- Unchanged results do not produce ordinary update snapshots. Recovery delivers a fresh snapshot even when the result is unchanged.
- Slow consumers keep a bounded pending result instead of accumulating every intermediate state. Live Data provides current views, not a mutation history.
- Query failures reject initial subscription or fail an existing iterator. They are not converted into empty results.
- `close()`, iterator `return()`, cancellation, and runtime disposal release subscription resources. `close()` is idempotent.

`batchWindowMs` defaults to zero. A configured window collects a burst of invalidations without indefinitely postponing refreshes. `revalidateEveryMs` is disabled unless configured; when enabled, it periodically refreshes active observers.

Cancellation is cooperative. The Mongo adapter forwards Runner's task signal to the driver. Other read tasks should honor that signal too; work that ignores it can continue after its subscription closes.

## Sharing And Context

Observer sharing is opt-in with `share: true`. Subscribers can share a read only when their canonical task and serialized raw input, validated input, topics, identity, and declared application contexts match. Property order is preserved because it can affect operations such as Mongo sorting. Sharing never crosses runtime instances.

Declare every additional application async context used by the read with `asyncContexts`, even when sharing is disabled. The active runtime identity is captured automatically. Background reads restore these captured values and clear undeclared application contexts so they cannot inherit the publisher's request state. Keep sharing disabled when a read depends on state beyond these captured inputs.

One subscriber leaving does not cancel work needed by the remaining subscribers. Once the final subscriber leaves, its observer releases provider subscriptions and timers.

## Lifecycle

`resources.liveData` owns subscriptions and observer state. Its provider resource owns messaging connections. Shutdown rejects new subscriptions, closes existing iterators, cancels active reads, and releases owned connections. Forced disposal also cleans up without relying on `cooldown()` having run.
