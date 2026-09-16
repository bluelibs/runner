import { r, run } from "../../../index";
import { live, resources } from "../../node";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

describe("live data refresh lifecycle", () => {
  it("serializes refreshes and discards a dirty in-flight result", async () => {
    let value = 1;
    let reads = 0;
    let refreshStarted!: () => void;
    const entered = new Promise<void>((resolve) => (refreshStarted = resolve));
    const gate = deferred();
    const read = r
      .task("read")
      .run(async () => {
        reads++;
        const captured = value;
        if (reads === 2) {
          refreshStarted();
          await gate.promise;
        }
        return captured;
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
    const subscription = await liveData.subscribe(query, undefined);
    await subscription.next();

    value = 2;
    await liveData.invalidate(changed);
    await entered;
    value = 3;
    await liveData.invalidate(changed);
    gate.resolve();
    await expect(subscription.next()).resolves.toMatchObject({
      value: { type: "snapshot", revision: 2, data: 3 },
    });
    expect(reads).toBe(3);
    await runtime.dispose();
  });

  it("fails the iterator when a refresh fails", async () => {
    const state: { failure?: Error } = {};
    const read = r
      .task("read")
      .run(async () => {
        if (state.failure) throw state.failure;
        return "ok";
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
    const subscription = await liveData.subscribe(query, undefined);
    await subscription.next();
    const failure = new Error("refresh failed");
    state.failure = failure;
    const next = subscription.next();
    await liveData.invalidate(changed);
    await expect(next).rejects.toBe(failure);
    await runtime.dispose();
  });

  it("aborts an active refresh when async iteration returns", async () => {
    let observedSignal: AbortSignal | undefined;
    let refreshStarted!: () => void;
    const entered = new Promise<void>((resolve) => (refreshStarted = resolve));
    let reads = 0;
    const read = r
      .task("read")
      .run(async (_input, _deps, context) => {
        reads++;
        if (reads === 1) return "initial";
        observedSignal = context?.signal;
        refreshStarted();
        await new Promise<void>((_resolve, reject) => {
          context?.signal?.addEventListener(
            "abort",
            () => reject(context?.signal?.reason),
            { once: true },
          );
        });
        return "never";
      })
      .build();
    const changed = live.topic("changed");
    const query = live.query({ task: read, topics: () => changed });
    const app = r
      .resource("app")
      .register([read, resources.liveData.with({ queries: [query] })])
      .build();
    const runtime = await run(app, { executionContext: true });
    const liveData = runtime.getResourceValue(resources.liveData);
    const subscription = await liveData.subscribe(query, undefined);
    await subscription.next();
    await liveData.invalidate(changed);
    await entered;
    await subscription.return();
    expect(observedSignal?.aborted).toBe(true);
    await expect(subscription.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    await runtime.dispose();
  });

  it("closes pending subscribers during normal and forced disposal", async () => {
    const read = r
      .task("read")
      .run(async () => 1)
      .build();
    const query = live.query({ task: read, topics: () => live.topic("x") });
    const app = r
      .resource("app")
      .register([read, resources.liveData.with({ queries: [query] })])
      .build();

    for (const force of [false, true]) {
      const runtime = await run(app);
      const subscription = await runtime
        .getResourceValue(resources.liveData)
        .subscribe(query, undefined);
      await subscription.next();
      const pending = subscription.next();
      await runtime.dispose(force ? { force: true } : undefined);
      await expect(pending).resolves.toEqual({ done: true, value: undefined });
    }
  });

  it("keeps default provider state isolated across runtimes", async () => {
    let reads = 0;
    let value = 1;
    const read = r
      .task("read")
      .run(async () => (++reads, value))
      .build();
    const changed = live.topic("same-topic");
    const query = live.query({ task: read, topics: () => changed });
    const app = r
      .resource("app")
      .register([read, resources.liveData.with({ queries: [query] })])
      .build();
    const firstRuntime = await run(app);
    const secondRuntime = await run(app);
    const first = await firstRuntime
      .getResourceValue(resources.liveData)
      .subscribe(query, undefined);
    const second = await secondRuntime
      .getResourceValue(resources.liveData)
      .subscribe(query, undefined);
    await first.next();
    await second.next();
    value = 2;
    await firstRuntime.getResourceValue(resources.liveData).invalidate(changed);
    await first.next();
    await flush();
    expect(reads).toBe(3);
    await firstRuntime.dispose();
    await secondRuntime.dispose();
  });
});
