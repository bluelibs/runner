import { asyncContexts, r, run } from "../../../index";
import { live, resources } from "../../node";
import type { LiveDataService } from "../../live-data/service";
import type {
  LiveDataProvider,
  LiveDataProviderEvent,
} from "../../live-data/types";

function providerWithCleanup(cleanup: () => Promise<void>): LiveDataProvider {
  return {
    connected: true,
    async publish() {},
    async subscribe(
      _topics: readonly string[],
      _listener: (event: LiveDataProviderEvent) => void,
    ) {
      return cleanup;
    },
    async dispose() {},
  };
}

describe("LiveDataService edge contracts", () => {
  it("rejects query contexts hidden behind an isolation boundary", async () => {
    const hiddenContext = r.asyncContext<string>("hidden-context").build();
    const hiddenOwner = r
      .resource("hidden-context-owner")
      .register([hiddenContext])
      .isolate({ exports: "none" })
      .build();
    const read = r
      .task("read-hidden-context")
      .run(async () => "value")
      .build();
    const liveQuery = live.query({
      task: read,
      topics: () => live.topic("hidden-context"),
      asyncContexts: [hiddenContext],
    });
    const app = r
      .resource("hidden-context-app")
      .register([
        hiddenOwner,
        read,
        resources.liveData.with({ queries: [liveQuery] }),
      ])
      .build();

    await expect(run(app)).rejects.toThrow(/Async context .* is not visible/);
  });

  it("runs observer reads outside the subscribing execution context", async () => {
    let taskSignal: AbortSignal | undefined;
    let executionSignal: AbortSignal | undefined;
    const read = r
      .task("read-dispatch-isolation")
      .run(async (_input, _dependencies, context) => {
        taskSignal = context?.signal;
        executionSignal = asyncContexts.execution.tryUse()?.signal;
        return "value";
      })
      .build();
    const liveQuery = live.query({
      task: read,
      topics: () => live.topic("dispatch-isolation"),
      asyncContexts: [asyncContexts.identity],
    });
    const app = r
      .resource("dispatch-isolation-app")
      .register([read, resources.liveData.with({ queries: [liveQuery] })])
      .build();
    const runtime = await run(app, { executionContext: true });
    const liveData = runtime.getResourceValue(resources.liveData);
    const caller = new AbortController();
    const subscription = await asyncContexts.execution.provide(
      { signal: caller.signal },
      () => liveData.subscribe(liveQuery, undefined),
    );

    await subscription.next();
    expect(taskSignal).toBeDefined();
    expect(taskSignal).not.toBe(caller.signal);
    expect(executionSignal).toBe(taskSignal);
    await runtime.dispose();
  });

  it("rejects subscriptions disposed during topic selection", async () => {
    const serviceRef: { current?: LiveDataService } = {};
    const read = r
      .task("read-disposed-topic-selection")
      .run(async () => "value")
      .build();
    const liveQuery = live.query({
      task: read,
      topics: () => {
        void serviceRef.current!.dispose();
        return live.topic("disposed-topic-selection");
      },
    });
    const app = r
      .resource("disposed-topic-selection-app")
      .register([read, resources.liveData.with({ queries: [liveQuery] })])
      .build();
    const runtime = await run(app);
    const liveData = runtime.getResourceValue(
      resources.liveData,
    ) as LiveDataService;
    serviceRef.current = liveData;

    await expect(liveData.subscribe(liveQuery, undefined)).rejects.toThrow(
      /subscribe after disposal/,
    );
    await runtime.dispose();
  });

  it("closes a shared subscriber when disposal wins after startup", async () => {
    const read = r
      .task("read-shared-disposal")
      .run(async () => "value")
      .build();
    const changed = live.topic("shared-disposal");
    const liveQuery = live.query({
      task: read,
      topics: () => changed,
      share: true,
    });
    const app = r
      .resource("shared-disposal-app")
      .register([read, resources.liveData.with({ queries: [liveQuery] })])
      .build();
    const runtime = await run(app);
    const liveData = runtime.getResourceValue(
      resources.liveData,
    ) as LiveDataService;
    const first = await liveData.subscribe(liveQuery, undefined);
    await first.next();
    const second = liveData.subscribe(liveQuery, undefined);
    await Promise.resolve();
    const disposal = liveData.dispose();

    await expect(second).rejects.toThrow(/subscribe after disposal/);
    await expect(liveData.subscribe(liveQuery, undefined)).rejects.toThrow(
      /subscribe after disposal/,
    );
    await expect(liveData.invalidate(changed)).rejects.toThrow(
      /invalidate after disposal/,
    );
    expect(liveData.dispose()).toBe(disposal);
    await disposal;
    await runtime.dispose();
  });

  it("surfaces observer cleanup failures during disposal", async () => {
    const failure = new Error("unsubscribe failed");
    const providerResource = r
      .resource("failing-cleanup-provider")
      .init(async () =>
        providerWithCleanup(async () => Promise.reject(failure)),
      )
      .build();
    const read = r
      .task("read-failing-cleanup")
      .run(async () => "value")
      .build();
    const liveQuery = live.query({
      task: read,
      topics: () => live.topic("failing-cleanup"),
    });
    const app = r
      .resource("failing-cleanup-app")
      .register([
        read,
        resources.liveData.with({
          queries: [liveQuery],
          provider: providerResource,
        }),
      ])
      .build();
    const runtime = await run(app);
    const liveData = runtime.getResourceValue(
      resources.liveData,
    ) as LiveDataService;
    const subscription = await liveData.subscribe(liveQuery, undefined);
    await subscription.next();

    await expect(liveData.dispose()).rejects.toBe(failure);
    await expect(runtime.dispose({ force: true })).rejects.toBe(failure);
  });

  it("does not let a retiring observer delete its replacement", async () => {
    const app = r
      .resource("retiring-observer-app")
      .register([resources.liveData.with({ queries: [] })])
      .build();
    const runtime = await run(app);
    const service = runtime.getResourceValue(
      resources.liveData,
    ) as LiveDataService;
    type ObserverLike = { close(): Promise<void> };
    type ServiceInternals = {
      observers: Map<string, ObserverLike>;
      retiringObservers: Set<Promise<void>>;
      retireObserver(key: string, observer: ObserverLike): void;
    };
    const internals = service as unknown as ServiceInternals;
    const replacement = { close: jest.fn(async () => undefined) };
    const retiring = { close: jest.fn(async () => undefined) };
    internals.observers.set("shared", replacement);

    internals.retireObserver("shared", retiring);
    expect(internals.observers.get("shared")).toBe(replacement);
    expect(retiring.close).toHaveBeenCalledTimes(1);
    await Promise.all([...internals.retiringObservers]);
    await Promise.resolve();
    expect(internals.retiringObservers.size).toBe(0);
    await runtime.dispose();
  });
});
