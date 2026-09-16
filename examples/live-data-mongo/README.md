# Live Mongo Queries

A Mongo query, an initial snapshot, and a live update. The example inserts a message, checks that the subscription received it, removes its own test data, and exits.

## Run

From the repository root, build Runner once:

```sh
npm install
npm run build
cd examples/live-data-mongo
npm install
docker compose up -d --wait
npm start
```

The subscription prints:

```text
Initial messages: []
Updated messages: [ 'Hello, live Mongo!' ]
```

The default provider runs in memory. To publish through Redis between two independent Runner runtimes:

```sh
npm run start:redis
```

The Mongo and Redis addresses are configurable with `MONGO_URL` and `REDIS_URL`. The included Compose file uses localhost ports `27027` and `6387` to avoid the usual development ports.

## The Setup

The full program is in [src/main.ts](./src/main.ts). Its live query is just:

```ts
const messages = live.mongo({
  collection: messagesCollection,
  key: "example.messages",
});

const threadMessages = messages.find("threadMessages", {
  inputSchema: { threadId: Match.NonEmptyString },
  query: ({ threadId }) => ({
    filter: { threadId },
    sort: { _id: 1 },
    limit: 20,
  }),
});
```

Register `threadMessages.task` and `resources.liveData.with({ queries: [threadMessages] })`, then subscribe:

```ts
const subscription = await liveData.subscribe(threadMessages, { threadId });
```

Writes use the native Mongo collection. Publish an invalidation after the write succeeds (after commit when using transactions):

```ts
await messagesCollection.insertOne(message);
await liveData.invalidate(messages.topic());
```

No Mongo replica set or change stream is required. Writes outside this publication path need their own invalidation or periodic revalidation. Redis reconnect triggers fresh queries; it does not replay missed mutations.

This example uses string document ids to keep its serialized result simple. It has no network API or authentication layer. Applications serving users should enforce a trusted tenant scope and authorization on their read tasks; see [Live Data](../../readmes/LIVE_DATA.md).

## Stop

```sh
docker compose down
```
