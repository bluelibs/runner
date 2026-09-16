import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { live, Match, r, resources, run } from "@bluelibs/runner/node";

type Message = { _id: string; threadId: string; text: string };

const mongo = r
  .resource("mongo")
  .init(async () => {
    const client = new MongoClient(
      process.env.MONGO_URL ?? "mongodb://localhost:27027/runner_live_example",
    );
    await client.connect();
    return client;
  })
  .dispose((client) => client.close())
  .build();

const messagesCollection = r
  .resource("messagesCollection")
  .dependencies({ mongo })
  .init(async (_config, { mongo }) =>
    mongo.db().collection<Message>("messages"),
  )
  .build();

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

const sendMessage = r
  .task("sendMessage")
  .inputSchema({ threadId: Match.NonEmptyString, text: Match.NonEmptyString })
  .dependencies({ messagesCollection, liveData: resources.liveData })
  .run(async (input, { messagesCollection, liveData }) => {
    await messagesCollection.insertOne({ _id: randomUUID(), ...input });
    await liveData.invalidate(messages.topic());
  })
  .build();

const app = r
  .resource("app")
  .register([
    mongo,
    messagesCollection,
    threadMessages.task,
    sendMessage,
    resources.liveData.with({
      queries: [threadMessages],
      provider: process.env.REDIS_URL
        ? resources.redisLiveDataProvider.with({
            redis: process.env.REDIS_URL,
            prefix: "runner-live-mongo-example",
          })
        : undefined,
    }),
  ])
  .build();

const runtime = await run(app);
const threadId = randomUUID();
const collection = runtime.getResourceValue(messagesCollection);

try {
  // A second runtime proves Redis carries changes between isolated observers.
  const writer = process.env.REDIS_URL ? await run(app) : runtime;
  try {
    const liveData = runtime.getResourceValue(resources.liveData);
    const subscription = await liveData.subscribe(
      threadMessages,
      { threadId },
      { signal: AbortSignal.timeout(10_000) },
    );

    const initial = await subscription.next();
    assert(!initial.done && initial.value.type === "snapshot");
    assert.deepEqual(initial.value.data, []);
    console.log("Initial messages:", initial.value.data);

    await writer.runTask(sendMessage, { threadId, text: "Hello, live Mongo!" });

    const updated = await subscription.next();
    assert(!updated.done && updated.value.type === "snapshot");
    assert.equal(updated.value.data.length, 1);
    assert.equal(updated.value.data[0].text, "Hello, live Mongo!");
    console.log(
      "Updated messages:",
      updated.value.data.map(({ text }) => text),
    );

    await subscription.close();
  } finally {
    if (writer !== runtime) await writer.dispose();
  }
} finally {
  try {
    await collection.deleteMany({ threadId });
  } finally {
    await runtime.dispose();
  }
}
