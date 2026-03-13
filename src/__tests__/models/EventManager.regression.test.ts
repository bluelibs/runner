import { defineEvent } from "../../define";
import { globalTags } from "../../globals/globalTags";
import { EventManager } from "../../models/EventManager";
import { ExecutionContextStore } from "../../models/ExecutionContextStore";
import { createMessageError } from "../../errors";
import { runtimeSource } from "../../types/runtimeSource";

describe("EventManager regressions", () => {
  it("dispose clears listeners and interceptors even after lock", async () => {
    const eventManager = new EventManager();
    const event = defineEvent<string>({ id: "reg-dispose" });
    const listener = jest.fn();
    const interceptor = jest.fn(async (next, e) => next(e));
    const hookInterceptor = jest.fn(async (next, hook, e) => next(hook, e));

    eventManager.addListener(event, listener);
    eventManager.intercept(interceptor);
    eventManager.interceptHook(hookInterceptor);
    eventManager.lock();
    eventManager.dispose();

    await eventManager.emit(event, "data", runtimeSource.runtime("src"));

    expect(listener).not.toHaveBeenCalled();
    expect(
      (eventManager as unknown as { emissionInterceptors: unknown[] })
        .emissionInterceptors,
    ).toHaveLength(0);
    expect(
      (eventManager as unknown as { hookInterceptors: unknown[] })
        .hookInterceptors,
    ).toHaveLength(0);
  });

  it("keeps using interceptor snapshot when dispose happens mid-emission", async () => {
    const eventManager = new EventManager();
    const event = defineEvent<string>({ id: "reg-dispose-snapshot" });
    const executionOrder: string[] = [];

    let releaseFirstInterceptor: (() => void) | undefined;
    const firstInterceptorGate = new Promise<void>((resolve) => {
      releaseFirstInterceptor = resolve;
    });

    eventManager.intercept(async (next, e) => {
      executionOrder.push("interceptor-1-start");
      await firstInterceptorGate;
      executionOrder.push("interceptor-1-next");
      await next(e);
      executionOrder.push("interceptor-1-end");
    });

    eventManager.intercept(async (next, e) => {
      executionOrder.push("interceptor-2");
      await next(e);
    });

    eventManager.addListener(event, () => {
      executionOrder.push("listener");
    });

    const emitPromise = eventManager.emit(
      event,
      "data",
      runtimeSource.runtime("src"),
    );
    await Promise.resolve();
    eventManager.dispose();
    if (!releaseFirstInterceptor) {
      throw createMessageError(
        "Expected first interceptor gate to be initialized",
      );
    }
    releaseFirstInterceptor();
    await emitPromise;

    expect(executionOrder).toEqual([
      "interceptor-1-start",
      "interceptor-1-next",
      "interceptor-2",
      "listener",
      "interceptor-1-end",
    ]);
  });

  it("rejects new emissions when shutdown lockdown is active", async () => {
    const eventManager = new EventManager();
    const event = defineEvent<string>({ id: "reg-shutdown-lockdown" });

    eventManager.enterShutdownLockdown();

    await expect(
      eventManager.emit(event, "data", runtimeSource.runtime("src")),
    ).rejects.toThrow(
      "Runtime is shutting down and no new task runs or event emissions are accepted.",
    );
  });

  it("emission snapshots meta and tags to avoid mutating event definition", async () => {
    const eventManager = new EventManager();
    const event = defineEvent<string>({
      id: "reg-snapshot",
      meta: { title: "base" },
      tags: [globalTags.system],
    });

    eventManager.addListener(event, (emission) => {
      emission.meta.title = "mutated";
      emission.tags.push(globalTags.debug.with("verbose"));
    });

    await eventManager.emit(event, "data", runtimeSource.runtime("src"));

    expect(event.meta?.title).toBe("base");
    expect(event.tags).toHaveLength(1);
    expect(event.tags[0]).toBe(globalTags.system);
  });

  it("rejects interceptor overrides of propagation methods", async () => {
    const eventManager = new EventManager();
    const event = defineEvent<string>({ id: "reg-stop-prop", parallel: false });
    const secondListener = jest.fn();

    eventManager.intercept(async (next, emission) => {
      return next({
        ...emission,
        stopPropagation: () => {
          // disallowed override
        },
        isPropagationStopped: () => false,
      });
    });

    eventManager.addListener(
      event,
      (emission) => {
        emission.stopPropagation();
      },
      { order: 0 },
    );
    eventManager.addListener(event, secondListener, { order: 1 });

    await expect(
      eventManager.emit(event, "data", runtimeSource.runtime("src")),
    ).rejects.toThrow(
      "Event interceptor validation failed for reg-stop-prop: Interceptors cannot override stopPropagation/isPropagationStopped",
    );
    expect(secondListener).not.toHaveBeenCalled();
  });

  it("rejects interceptor payloads that drop propagation methods", async () => {
    const eventManager = new EventManager();
    const event = defineEvent<string>({ id: "reg-restore-prop" });

    eventManager.intercept(async (next, emission) => {
      const { stopPropagation, isPropagationStopped, ...unsafeEvent } =
        emission as unknown as {
          stopPropagation: () => void;
          isPropagationStopped: () => boolean;
          [key: string]: unknown;
        };

      return next(unsafeEvent as any);
    });

    await expect(
      eventManager.emit(event, "data", runtimeSource.runtime("src")),
    ).rejects.toThrow(
      "Event interceptor validation failed for reg-restore-prop: Interceptors cannot override stopPropagation/isPropagationStopped",
    );
  });

  it("allows interceptor replacement when propagation methods are preserved", async () => {
    const eventManager = new EventManager();
    const event = defineEvent<string>({ id: "reg-keep-prop", parallel: false });
    const secondListener = jest.fn();

    eventManager.intercept(async (next, emission) => {
      return next({
        ...emission,
        data: `${emission.data}-updated`,
      });
    });

    eventManager.addListener(
      event,
      (emission) => {
        expect(emission.data).toBe("data-updated");
        emission.stopPropagation();
      },
      { order: 0 },
    );
    eventManager.addListener(event, secondListener, { order: 1 });

    await expect(
      eventManager.emit(event, "data", runtimeSource.runtime("src")),
    ).resolves.toBeUndefined();
    expect(secondListener).not.toHaveBeenCalled();
  });

  it("rejects interceptors that call next() more than once", async () => {
    const eventManager = new EventManager();
    const event = defineEvent<string>({ id: "reg-next-once" });

    eventManager.intercept(async (next, emission) => {
      await next(emission);
      return next(emission);
    });

    await expect(
      eventManager.emit(event, "data", runtimeSource.runtime("src")),
    ).rejects.toThrow("Interceptors can call next() only once per emission.");
  });

  it("does not treat distinct runtime hook instances as repetition cycle", async () => {
    const eventManager = new EventManager({
      executionContextStore: new ExecutionContextStore({
        maxDepth: 100,
        maxRepetitions: 2,
      }),
    });

    let currentHookPath = "root.first.shared-hook";
    eventManager.bindStore({
      createRuntimeSource: () => runtimeSource.hook(currentHookPath),
      events: new Map() as any,
      getRuntimeMetadata: () => {
        throw createMessageError("getRuntimeMetadata should not be called");
      },
      resolveDefinitionId: () => undefined,
      toRuntimeSource: (source) => source,
    });

    const hook = {
      id: "shared-hook",
      run: jest.fn(async () => {
        if (currentHookPath === "root.first.shared-hook") {
          currentHookPath = "root.second.shared-hook";
          await eventManager.executeHookWithInterceptors(
            hook as any,
            {} as any,
            {},
          );
        }
        return undefined;
      }),
    };

    await expect(
      eventManager.executeHookWithInterceptors(hook as any, {} as any, {}),
    ).resolves.toBeUndefined();

    expect(hook.run).toHaveBeenCalledTimes(2);
  });

  it("falls back to definition hook id when runtime source path is missing", async () => {
    const eventManager = new EventManager({
      executionContextStore: new ExecutionContextStore({
        maxDepth: 100,
        maxRepetitions: 2,
      }),
    });

    const hook = {
      id: "pathless-hook",
      run: jest.fn(async () => undefined),
    };

    eventManager.bindStore({
      createRuntimeSource: () => ({
        kind: "hook",
        id: "pathless-hook",
      }),
      events: new Map() as any,
      getRuntimeMetadata: () => {
        throw createMessageError("getRuntimeMetadata should not be called");
      },
      resolveDefinitionId: () => undefined,
      toRuntimeSource: (source) => source,
    });

    await expect(
      eventManager.executeHookWithInterceptors(hook as any, {} as any, {}),
    ).resolves.toBeUndefined();
  });
});
