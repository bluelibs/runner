import { AsyncResource } from "node:async_hooks";
import { asyncContexts, r, run } from "../../../index";
import { createLiveDispatchScope } from "../../live-data/dispatchScope";

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("createLiveDispatchScope", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("isolates dispatch work from each caller execution", async () => {
    const dispatchScope = r
      .resource("dispatchScope")
      .init(async () => createLiveDispatchScope())
      .dispose(async (scope) => scope.dispose())
      .build();
    const inspectDispatch = r
      .task("inspectDispatch")
      .dependencies({ dispatchScope })
      .run(async (_input, dependencies, context) => ({
        callerSignal: context?.signal,
        dispatchSignals: await dependencies.dispatchScope.run(async () => {
          const sync = asyncContexts.execution.tryUse()?.signal;
          await Promise.resolve();
          const asynchronous = asyncContexts.execution.tryUse()?.signal;
          await nextTurn();
          const timer = asyncContexts.execution.tryUse()?.signal;
          const nested = dependencies.dispatchScope.run(
            () => asyncContexts.execution.tryUse()?.signal,
          );
          return { sync, asynchronous, timer, nested };
        }),
      }))
      .build();
    const app = r
      .resource("app")
      .register([dispatchScope, inspectDispatch])
      .build();
    const runtime = await run(app, { executionContext: true });
    const subscriber = new AbortController();
    const publisher = new AbortController();

    for (const caller of [subscriber, publisher]) {
      await expect(
        runtime.runTask(inspectDispatch, undefined, { signal: caller.signal }),
      ).resolves.toEqual({
        callerSignal: caller.signal,
        dispatchSignals: {
          sync: undefined,
          asynchronous: undefined,
          timer: undefined,
          nested: undefined,
        },
      });
    }

    await runtime.dispose();
  });

  it("returns synchronous results and destroys its async resource", () => {
    const emitDestroy = jest.spyOn(AsyncResource.prototype, "emitDestroy");
    const scope = createLiveDispatchScope();

    expect(scope.run(() => "result")).toBe("result");
    scope.dispose();

    expect(emitDestroy).toHaveBeenCalledTimes(1);
  });
});
