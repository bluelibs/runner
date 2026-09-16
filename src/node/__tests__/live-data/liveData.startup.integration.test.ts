import { r, run } from "../../../index";
import { live, resources } from "../../node";
import type { LiveDataProvider } from "../../live-data/types";

describe("live data startup cleanup", () => {
  it("retires a shared observer when startup and unsubscribe both fail", async () => {
    const startupFailure = new Error("startup failed");
    const cleanupFailure = new Error("cleanup failed");
    let reads = 0;
    let providerSubscriptions = 0;
    const provider: LiveDataProvider = {
      connected: true,
      async publish() {},
      async subscribe() {
        providerSubscriptions++;
        const subscription = providerSubscriptions;
        return async () => {
          if (subscription === 1) throw cleanupFailure;
        };
      },
      async dispose() {},
    };
    const providerResource = r
      .resource("provider")
      .init(async () => provider)
      .build();
    const read = r
      .task("read")
      .run(async () => {
        if (++reads === 1) throw startupFailure;
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

    const failure = await liveData.subscribe(query, undefined).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      data: {
        originalError: {
          name: "LiveDataStartupCleanupError",
          errors: [startupFailure, cleanupFailure],
        },
      },
    });

    const recovered = await liveData.subscribe(query, undefined);
    await expect(recovered.next()).resolves.toMatchObject({
      value: { type: "snapshot", data: "ready" },
    });
    expect(providerSubscriptions).toBe(2);
    await runtime.dispose();
  });
});
