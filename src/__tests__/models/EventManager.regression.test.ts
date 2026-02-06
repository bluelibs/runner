import { defineEvent } from "../../define";
import { globalTags } from "../../globals/globalTags";
import { EventManager } from "../../models/EventManager";

describe("EventManager regressions", () => {
  it("dispose clears listeners and interceptors even after lock", async () => {
    const eventManager = new EventManager({ runtimeEventCycleDetection: true });
    const event = defineEvent<string>({ id: "reg.dispose" });
    const listener = jest.fn();
    const interceptor = jest.fn(async (next, e) => next(e));
    const hookInterceptor = jest.fn(async (next, hook, e) => next(hook, e));

    eventManager.addListener(event, listener);
    eventManager.intercept(interceptor);
    eventManager.interceptHook(hookInterceptor);
    eventManager.lock();
    eventManager.dispose();

    await eventManager.emit(event, "data", "src");

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

  it("emission snapshots meta and tags to avoid mutating event definition", async () => {
    const eventManager = new EventManager({ runtimeEventCycleDetection: true });
    const event = defineEvent<string>({
      id: "reg.snapshot",
      meta: { title: "base" },
      tags: [globalTags.system],
    });

    eventManager.addListener(event, (emission) => {
      emission.meta.title = "mutated";
      emission.tags.push(globalTags.debug);
    });

    await eventManager.emit(event, "data", "src");

    expect(event.meta?.title).toBe("base");
    expect(event.tags).toHaveLength(1);
    expect(event.tags[0]).toBe(globalTags.system);
  });

  it("rejects interceptor overrides of propagation methods", async () => {
    const eventManager = new EventManager({ runtimeEventCycleDetection: true });
    const event = defineEvent<string>({ id: "reg.stop-prop", parallel: false });
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

    await expect(eventManager.emit(event, "data", "src")).rejects.toThrow(
      "Event interceptor validation failed for reg.stop-prop: Interceptors cannot override stopPropagation/isPropagationStopped",
    );
    expect(secondListener).not.toHaveBeenCalled();
  });

  it("rejects interceptor payloads that drop propagation methods", async () => {
    const eventManager = new EventManager({ runtimeEventCycleDetection: true });
    const event = defineEvent<string>({ id: "reg.restore-prop" });

    eventManager.intercept(async (next, emission) => {
      const { stopPropagation, isPropagationStopped, ...unsafeEvent } =
        emission as unknown as {
          stopPropagation: () => void;
          isPropagationStopped: () => boolean;
          [key: string]: unknown;
        };

      return next(unsafeEvent as any);
    });

    await expect(eventManager.emit(event, "data", "src")).rejects.toThrow(
      "Event interceptor validation failed for reg.restore-prop: Interceptors cannot override stopPropagation/isPropagationStopped",
    );
  });

  it("allows interceptor replacement when propagation methods are preserved", async () => {
    const eventManager = new EventManager({ runtimeEventCycleDetection: true });
    const event = defineEvent<string>({ id: "reg.keep-prop", parallel: false });
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
      eventManager.emit(event, "data", "src"),
    ).resolves.toBeUndefined();
    expect(secondListener).not.toHaveBeenCalled();
  });
});
