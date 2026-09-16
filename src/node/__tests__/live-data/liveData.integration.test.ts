import { asyncContexts, Match, r, run } from "../../../index";
import { live, resources } from "../../node";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("live data", () => {
  it("buffers snapshots, refreshes changes, and suppresses unchanged results", async () => {
    let value = 1;
    let reads = 0;
    const read = r
      .task("read")
      .inputSchema({ id: Match.NonEmptyString })
      .run(async ({ id }) => {
        reads++;
        return { id, value };
      })
      .build();
    const topic = live.topic("record", "one");
    const query = live.query({ task: read, topics: () => topic });
    const app = r
      .resource("app")
      .register([read, resources.liveData.with({ queries: [query] })])
      .build();
    const runtime = await run(app);
    const liveData = runtime.getResourceValue(resources.liveData);
    const subscription = await liveData.subscribe(query, { id: "one" });

    await expect(subscription.next()).resolves.toMatchObject({
      done: false,
      value: { type: "snapshot", revision: 1, data: { id: "one", value: 1 } },
    });
    value = 2;
    await liveData.invalidate(topic);
    await expect(subscription.next()).resolves.toMatchObject({
      value: { type: "snapshot", revision: 2, data: { value: 2 } },
    });

    await liveData.invalidate(topic);
    await flush();
    expect(reads).toBe(3);
    const pending = subscription.next();
    await subscription.close();
    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    await runtime.dispose();
  });

  it("re-runs when invalidated during the initial read", async () => {
    let value = 1;
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => (started = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reads = 0;
    const read = r
      .task("read")
      .run(async () => {
        reads++;
        if (reads === 1) {
          started();
          await gate;
        }
        return value;
      })
      .build();
    const changed = live.topic("changed");
    const query = live.query({ task: read, topics: () => changed });
    const app = r
      .resource("app")
      .register([read, resources.liveData.with({ queries: [query] })])
      .build();
    const runtime = await run(app);
    const liveData = runtime.getResourceValue(resources.liveData);
    const subscribing = liveData.subscribe(query, undefined);
    await entered;
    value = 2;
    await liveData.invalidate(changed);
    release();
    const subscription = await subscribing;

    await expect(subscription.next()).resolves.toMatchObject({
      value: { type: "snapshot", data: 2 },
    });
    expect(reads).toBe(2);
    await runtime.dispose();
  });

  it("shares one observer and restores captured identity", async () => {
    let reads = 0;
    let version = 1;
    const read = r
      .task("read")
      .run(async () => {
        reads++;
        return { tenantId: asyncContexts.identity.use().tenantId, version };
      })
      .build();
    const changed = live.topic("shared");
    const query = live.query({
      task: read,
      topics: () => changed,
      share: true,
    });
    const app = r
      .resource("app")
      .register([read, resources.liveData.with({ queries: [query] })])
      .build();
    const runtime = await run(app);
    const liveData = runtime.getResourceValue(resources.liveData);
    const [first, second] = await asyncContexts.identity.provide(
      { tenantId: "tenant-a", region: "test" },
      () =>
        Promise.all([
          liveData.subscribe(query, undefined),
          liveData.subscribe(query, undefined),
        ]),
    );

    await expect(first.next()).resolves.toMatchObject({
      value: { data: { tenantId: "tenant-a", version: 1 } },
    });
    await expect(second.next()).resolves.toMatchObject({
      value: { data: { tenantId: "tenant-a", version: 1 } },
    });
    expect(reads).toBe(1);
    version = 2;
    await asyncContexts.identity.provide(
      { tenantId: "publisher", region: "test" },
      () => liveData.invalidate(changed),
    );
    await expect(first.next()).resolves.toMatchObject({
      value: { data: { tenantId: "tenant-a", version: 2 } },
    });
    expect(reads).toBe(2);
    await first.close();
    await second.close();
    await runtime.dispose();
  });

  it("rejects read failures and closes pending iteration during forced disposal", async () => {
    const failure = new Error("read failed");
    const read = r
      .task("read")
      .run(async () => Promise.reject(failure))
      .build();
    const query = live.query({ task: read, topics: () => live.topic("x") });
    const app = r
      .resource("app")
      .register([read, resources.liveData.with({ queries: [query] })])
      .build();
    const runtime = await run(app);
    await expect(
      runtime.getResourceValue(resources.liveData).subscribe(query, undefined),
    ).rejects.toBe(failure);
    await runtime.dispose({ force: true });
  });

  it("rejects unregistered queries and pre-aborted subscriptions", async () => {
    const read = r
      .task("read")
      .run(async () => 1)
      .build();
    const registered = live.query({
      task: read,
      topics: () => live.topic("x"),
    });
    const unknown = live.query({ task: read, topics: () => live.topic("y") });
    const app = r
      .resource("app")
      .register([read, resources.liveData.with({ queries: [registered] })])
      .build();
    const runtime = await run(app);
    const liveData = runtime.getResourceValue(resources.liveData);
    await expect(liveData.subscribe(unknown, undefined)).rejects.toThrow(
      "not registered",
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      liveData.subscribe(registered, undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await runtime.dispose();
  });
});
