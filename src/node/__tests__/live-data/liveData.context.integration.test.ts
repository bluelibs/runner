import { asyncContexts, Match, r, run } from "../../../index";
import { live, resources } from "../../node";
import type {
  LiveDataProvider,
  LiveDataProviderEvent,
} from "../../live-data/types";

describe("live data contracts and context", () => {
  it("captures only declared contexts and restores absent identity", async () => {
    const locale = r.asyncContext<{ language: string }>("locale").build();
    const undeclared = r.asyncContext<{ secret: string }>("secret").build();
    let version = 1;
    const read = r
      .task("read")
      .run(async () => ({
        identity: asyncContexts.identity.tryUse(),
        locale: locale.use(),
        secret: undeclared.tryUse(),
        version,
      }))
      .build();
    const changed = live.topic("context");
    const query = live.query({
      task: read,
      topics: () => changed,
      asyncContexts: [locale],
    });
    const app = r
      .resource("app")
      .register([
        locale,
        undeclared,
        read,
        resources.liveData.with({ queries: [query] }),
      ])
      .build();
    const runtime = await run(app);
    const liveData = runtime.getResourceValue(resources.liveData);
    const subscription = await locale.provide({ language: "ro" }, () =>
      liveData.subscribe(query, undefined),
    );
    await expect(subscription.next()).resolves.toMatchObject({
      value: {
        data: {
          identity: undefined,
          locale: { language: "ro" },
          secret: undefined,
          version: 1,
        },
      },
    });

    version = 2;
    await asyncContexts.identity.provide(
      { tenantId: "publisher", region: "test" },
      () =>
        undeclared.provide({ secret: "publisher-secret" }, () =>
          locale.provide({ language: "en" }, () =>
            liveData.invalidate(changed),
          ),
        ),
    );
    await expect(subscription.next()).resolves.toMatchObject({
      value: {
        data: {
          identity: undefined,
          locale: { language: "ro" },
          secret: undefined,
          version: 2,
        },
      },
    });
    await runtime.dispose();
  });

  it("snapshots input before topic selection and every task read", async () => {
    const inputs: string[] = [];
    const read = r
      .task("read")
      .inputSchema({ id: Match.NonEmptyString })
      .run(async (input) => {
        inputs.push(input.id);
        input.id = "mutated-by-task";
        return inputs.length;
      })
      .build();
    const changed = live.topic("input", "original");
    const query = live.query({
      task: read,
      topics: (input) => live.topic("input", input.id),
    });
    const app = r
      .resource("app")
      .register([read, resources.liveData.with({ queries: [query] })])
      .build();
    const runtime = await run(app);
    const liveData = runtime.getResourceValue(resources.liveData);
    const input = { id: "original" };
    const subscription = await liveData.subscribe(query, input);
    await subscription.next();
    input.id = "mutated-by-caller";
    await liveData.invalidate(changed);
    await subscription.next();
    expect(inputs).toEqual(["original", "original"]);
    await runtime.dispose();
  });

  it("fails bootstrap for unregistered and invisible query tasks", async () => {
    const unregisteredTask = r
      .task("missing")
      .run(async () => 1)
      .build();
    const unregisteredQuery = live.query({
      task: unregisteredTask,
      topics: () => live.topic("missing"),
    });
    const missingApp = r
      .resource("missingApp")
      .register([resources.liveData.with({ queries: [unregisteredQuery] })])
      .build();
    await expect(run(missingApp)).rejects.toThrow();

    const hiddenTask = r
      .task("hidden")
      .run(async () => 1)
      .build();
    const hiddenOwner = r
      .resource("hiddenOwner")
      .register([hiddenTask])
      .isolate({ exports: "none" })
      .build();
    const hiddenQuery = live.query({
      task: hiddenTask,
      topics: () => live.topic("hidden"),
    });
    const hiddenApp = r
      .resource("hiddenApp")
      .register([
        hiddenOwner,
        resources.liveData.with({ queries: [hiddenQuery] }),
      ])
      .build();
    await expect(run(hiddenApp)).rejects.toThrow("not visible");
  });

  it("marks stale on disconnect, skips reads, then snapshots after resync", async () => {
    const control = createControlledProvider();
    const providerResource = r
      .resource("controlledProvider")
      .init(async () => control.provider)
      .build();
    let reads = 0;
    const read = r
      .task("read")
      .run(async () => (++reads, "same"))
      .build();
    const query = live.query({ task: read, topics: () => live.topic("x") });
    const app = r
      .resource("app")
      .register([
        read,
        resources.liveData.with({
          queries: [query],
          provider: providerResource,
        }),
      ])
      .build();
    const runtime = await run(app);
    const liveData = runtime.getResourceValue(resources.liveData);
    const subscription = await liveData.subscribe(query, undefined);
    await subscription.next();
    control.disconnect();
    await expect(subscription.next()).resolves.toEqual({
      done: false,
      value: { type: "stale", reason: "bus-disconnected" },
    });
    control.invalidate();
    expect(reads).toBe(1);
    await expect(liveData.subscribe(query, undefined)).rejects.toThrow(
      "disconnected",
    );
    control.resync();
    await expect(subscription.next()).resolves.toMatchObject({
      value: { type: "snapshot", revision: 2, data: "same" },
    });
    expect(reads).toBe(2);
    await runtime.dispose();
  });

  it("rejects unregistered BSON prototypes in inputs, contexts, and results", async () => {
    class FakeObjectId {
      readonly _bsontype = "ObjectId";
      constructor(readonly value: string) {}
    }
    const requestContext = r
      .asyncContext<{ id: FakeObjectId }>("request")
      .build();
    const inputTask = r
      .task<{ id: FakeObjectId }>("input")
      .run(async ({ id }) => id.value)
      .build();
    const contextTask = r
      .task("context")
      .run(async () => requestContext.use().id.value)
      .build();
    const resultTask = r
      .task("result")
      .run(async () => new FakeObjectId("result"))
      .build();
    const inputQuery = live.query({
      task: inputTask,
      topics: () => live.topic("input"),
    });
    const contextQuery = live.query({
      task: contextTask,
      topics: () => live.topic("context"),
      asyncContexts: [requestContext],
    });
    const resultQuery = live.query({
      task: resultTask,
      topics: () => live.topic("result"),
    });
    const app = r
      .resource("bsonApp")
      .register([
        requestContext,
        inputTask,
        contextTask,
        resultTask,
        resources.liveData.with({
          queries: [inputQuery, contextQuery, resultQuery],
        }),
      ])
      .build();
    const runtime = await run(app);
    const liveData = runtime.getResourceValue(resources.liveData);

    await expect(
      liveData.subscribe(inputQuery, { id: new FakeObjectId("input") }),
    ).rejects.toThrow("BSON values must be registered");
    await expect(
      requestContext.provide({ id: new FakeObjectId("context") }, () =>
        liveData.subscribe(contextQuery, undefined),
      ),
    ).rejects.toThrow("BSON values must be registered");
    await expect(liveData.subscribe(resultQuery, undefined)).rejects.toThrow(
      "BSON values must be registered",
    );
    await runtime.dispose();
  });
});

function createControlledProvider() {
  let connected = true;
  const listeners = new Set<(event: LiveDataProviderEvent) => void>();
  const provider: LiveDataProvider = {
    get connected() {
      return connected;
    },
    async publish() {},
    async subscribe(_topics, listener) {
      listeners.add(listener);
      return async () => {
        listeners.delete(listener);
      };
    },
    async dispose() {
      listeners.clear();
    },
  };
  return {
    provider,
    disconnect() {
      connected = false;
      for (const listener of listeners) listener({ type: "disconnect" });
    },
    invalidate() {
      for (const listener of listeners) {
        listener({ type: "invalidate", topics: ['["x"]'] });
      }
    },
    resync() {
      connected = true;
      for (const listener of listeners) listener({ type: "resync" });
    },
  };
}
