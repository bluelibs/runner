import { r, run } from "../../../index";
import { live, resources } from "../../node";
import type {
  LiveDataProvider,
  LiveDataProviderEvent,
} from "../../live-data/types";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("live data subscription races", () => {
  it("cleans up when aborted during provider subscription readiness", async () => {
    const ready = deferred();
    const entered = deferred();
    let unsubscribes = 0;
    const provider = createProvider(async () => {
      entered.resolve();
      await ready.promise;
      return async () => {
        unsubscribes++;
      };
    });
    let reads = 0;
    const read = r
      .task("read")
      .run(async () => ++reads)
      .build();
    const query = live.query({ task: read, topics: () => live.topic("x") });
    const runtime = await run(createApp(read, query, provider));
    const controller = new AbortController();
    const subscribing = runtime
      .getResourceValue(resources.liveData)
      .subscribe(query, undefined, { signal: controller.signal });
    const rejection = subscribing.then(
      () => new Error("Expected subscription to reject."),
      (error: unknown) => error,
    );
    await entered.promise;
    controller.abort();
    ready.resolve();

    expect(await rejection).toMatchObject({ name: "AbortError" });
    expect(unsubscribes).toBe(1);
    expect(reads).toBe(0);
    await runtime.dispose();
  });

  it("keeps shared startup alive when only one initial subscriber aborts", async () => {
    const entered = deferred();
    const readGate = deferred();
    let reads = 0;
    const read = r
      .task("read")
      .run(async () => {
        reads++;
        entered.resolve();
        await readGate.promise;
        return "ready";
      })
      .build();
    const query = live.query({
      task: read,
      topics: () => live.topic("shared"),
      share: true,
    });
    const app = r
      .resource("app")
      .register([read, resources.liveData.with({ queries: [query] })])
      .build();
    const runtime = await run(app);
    const liveData = runtime.getResourceValue(resources.liveData);
    const controller = new AbortController();
    const first = liveData.subscribe(query, undefined, {
      signal: controller.signal,
    });
    const firstRejection = first.then(
      () => new Error("Expected subscription to reject."),
      (error: unknown) => error,
    );
    const second = liveData.subscribe(query, undefined);
    await entered.promise;
    controller.abort();
    readGate.resolve();

    expect(await firstRejection).toMatchObject({ name: "AbortError" });
    const active = await second;
    await expect(active.next()).resolves.toMatchObject({
      value: { type: "snapshot", data: "ready" },
    });
    expect(reads).toBe(1);
    await runtime.dispose();
  });

  it("does not reuse a closing shared observer", async () => {
    const unsubscribeGate = deferred();
    let subscriptions = 0;
    const provider = createProvider(async () => {
      subscriptions++;
      const call = subscriptions;
      return async () => {
        if (call === 1) await unsubscribeGate.promise;
      };
    });
    let reads = 0;
    const read = r
      .task("read")
      .run(async () => ++reads)
      .build();
    const query = live.query({
      task: read,
      topics: () => live.topic("shared"),
      share: true,
    });
    const runtime = await run(createApp(read, query, provider));
    const liveData = runtime.getResourceValue(resources.liveData);
    const first = await liveData.subscribe(query, undefined);
    await first.next();
    const closing = first.close();
    await flush();

    const second = await liveData.subscribe(query, undefined);
    await expect(second.next()).resolves.toMatchObject({
      value: { type: "snapshot", data: 2 },
    });
    expect(subscriptions).toBe(2);
    let disposed = false;
    const disposing = runtime.dispose().then(() => {
      disposed = true;
    });
    await flush();
    expect(disposed).toBe(false);
    unsubscribeGate.resolve();
    await closing;
    await disposing;
  });

  it("rejects when the provider disconnects during the initial read", async () => {
    const listeners = new Set<(event: LiveDataProviderEvent) => void>();
    const provider = createProvider(async (listener) => {
      listeners.add(listener);
      return async () => {
        listeners.delete(listener);
      };
    });
    const entered = deferred();
    const read = r
      .task("read")
      .run(async (_input, _deps, context) => {
        const signal = context?.signal;
        if (!signal) throw new Error("Expected a task abort signal.");
        entered.resolve();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
        return "never";
      })
      .build();
    const query = live.query({ task: read, topics: () => live.topic("x") });
    const runtime = await run(createApp(read, query, provider));
    const subscribing = runtime
      .getResourceValue(resources.liveData)
      .subscribe(query, undefined);
    const rejection = subscribing.then(
      () => new Error("Expected subscription to reject."),
      (error: unknown) => error,
    );
    await entered.promise;
    provider.setConnected(false);
    for (const listener of listeners) listener({ type: "disconnect" });
    await expect(rejection).resolves.toThrow(
      "disconnected before the initial snapshot",
    );
    await runtime.dispose();
  });

  it("retries when disconnect and resync race an aborted refresh", async () => {
    const listeners = new Set<(event: LiveDataProviderEvent) => void>();
    const provider = createProvider(async (listener) => {
      listeners.add(listener);
      return async () => {
        listeners.delete(listener);
      };
    });
    const refreshEntered = deferred();
    let reads = 0;
    const read = r
      .task("read")
      .run(async (_input, _deps, context) => {
        const signal = context?.signal;
        if (!signal) throw new Error("Expected a task abort signal.");
        reads++;
        if (reads === 2) {
          refreshEntered.resolve();
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
        }
        return reads;
      })
      .build();
    const changed = live.topic("changed");
    const query = live.query({ task: read, topics: () => changed });
    const runtime = await run(createApp(read, query, provider));
    const liveData = runtime.getResourceValue(resources.liveData);
    const subscription = await liveData.subscribe(query, undefined);
    await subscription.next();
    for (const listener of listeners) {
      listener({ type: "invalidate", topics: ['["changed"]'] });
    }
    await refreshEntered.promise;
    provider.setConnected(false);
    for (const listener of listeners) listener({ type: "disconnect" });
    provider.setConnected(true);
    for (const listener of listeners) listener({ type: "resync" });

    await expect(subscription.next()).resolves.toMatchObject({
      value: { type: "stale" },
    });
    await expect(subscription.next()).resolves.toMatchObject({
      value: { type: "snapshot", data: 3 },
    });
    expect(reads).toBe(3);
    await runtime.dispose();
  });
});

function createProvider(
  subscribe: (
    listener: (event: LiveDataProviderEvent) => void,
  ) => Promise<() => Promise<void>>,
) {
  let connected = true;
  const provider: LiveDataProvider & { setConnected(value: boolean): void } = {
    get connected() {
      return connected;
    },
    setConnected(value) {
      connected = value;
    },
    async publish() {},
    async subscribe(_topics, listener) {
      return subscribe(listener);
    },
    async dispose() {},
  };
  return provider;
}

function createApp(
  task: Parameters<typeof live.query>[0]["task"],
  query: ReturnType<typeof live.query>,
  provider: LiveDataProvider,
) {
  const providerResource = r
    .resource("provider")
    .init(async () => provider)
    .build();
  return r
    .resource("app")
    .register([
      task,
      resources.liveData.with({ queries: [query], provider: providerResource }),
    ])
    .build();
}
