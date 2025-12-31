import { IEvent, IEventEmission } from "../../defs";
import { EventManager } from "../../models/EventManager";
import { defineEvent } from "../../define";
import { globalTags } from "../../globals/globalTags";

describe("EventManager", () => {
  let eventManager: EventManager;
  let eventDefinition: IEvent<string>;

  beforeEach(() => {
    eventManager = new EventManager({ runtimeCycleDetection: true });
    eventDefinition = defineEvent<string>({ id: "testEvent" });
  });

  it("should add and emit event listener", async () => {
    const handler = jest.fn();
    eventManager.addListener(eventDefinition, handler);

    await eventManager.emit(eventDefinition, "testData", "test");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "testEvent",
        data: "testData",
        timestamp: expect.any(Date),
      }),
    );
  });

  it("should respect listener order", async () => {
    const results: number[] = [];

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push(1);
      },
      { order: 2 },
    );

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push(0);
      },
      { order: 1 },
    );

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push(3);
      },
      { order: 4 },
    );

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push(2);
      },
      { order: 3 },
    );

    await eventManager.emit(eventDefinition, "testData", "test");

    expect(results).toEqual([0, 1, 2, 3]);
  });

  // Event-specific filters are no longer supported; filtering remains only for global listeners

  it("should add and emit global listener", async () => {
    const handler = jest.fn();

    eventManager.addGlobalListener(handler);

    await eventManager.emit(eventDefinition, "testData", "test");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "testEvent",
        data: "testData",
        timestamp: expect.any(Date),
      }),
    );
  });

  it("global listeners should respect order with event listeners", async () => {
    const results: string[] = [];

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push("eventListener1");
      },
      { order: 2 },
    );

    eventManager.addGlobalListener(
      () => {
        results.push("globalListener1");
      },
      { order: 1 },
    );

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push("eventListener2");
      },
      { order: 4 },
    );

    eventManager.addGlobalListener(
      () => {
        results.push("globalListener2");
      },
      { order: 3 },
    );

    await eventManager.emit(eventDefinition, "testData", "test");

    expect(results).toEqual([
      "globalListener1",
      "eventListener1",
      "globalListener2",
      "eventListener2",
    ]);
  });

  it("should lock and prevent adding new listeners", () => {
    eventManager.lock();

    expect(eventManager.isLocked).toBe(true);

    const handler = jest.fn();

    expect(() => {
      eventManager.addListener(eventDefinition, handler);
    }).toThrow("Cannot modify the EventManager when it is locked.");

    expect(() => {
      eventManager.addGlobalListener(handler);
    }).toThrow("Cannot modify the EventManager when it is locked.");
  });

  it("should handle multiple events", async () => {
    const eventDef1 = defineEvent<string>({ id: "event1" });
    const eventDef2 = defineEvent<string>({ id: "event2" });

    const handler1 = jest.fn();
    const handler2 = jest.fn();

    eventManager.addListener(eventDef1, handler1);
    eventManager.addListener(eventDef2, handler2);

    await eventManager.emit(eventDef1, "data1", "test");
    await eventManager.emit(eventDef2, "data2", "test");

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler1).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "event1",
        data: "data1",
        timestamp: expect.any(Date),
      }),
    );

    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "event2",
        data: "data2",
      }),
    );
  });

  it("should allow adding multiple listeners to the same event", async () => {
    const handler1 = jest.fn();
    const handler2 = jest.fn();

    eventManager.addListener(eventDefinition, handler1);
    eventManager.addListener(eventDefinition, handler2);

    await eventManager.emit(eventDefinition, "testData", "test");

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it("should handle listeners added to multiple events", async () => {
    const eventDef1 = defineEvent<string>({ id: "event1" });
    const eventDef2 = defineEvent<string>({ id: "event2" });

    const handler = jest.fn();

    eventManager.addListener([eventDef1, eventDef2], handler);

    await eventManager.emit(eventDef1, "data1", "test");
    await eventManager.emit(eventDef2, "data2", "test");

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "event1",
        data: "data1",
      }),
    );
    expect(handler).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "event2",
        data: "data2",
      }),
    );
  });

  it("should not affect other events when emitting one", async () => {
    const eventDef1 = defineEvent<string>({ id: "event1" });
    const eventDef2 = defineEvent<string>({ id: "event2" });

    const handler1 = jest.fn();
    const handler2 = jest.fn();

    eventManager.addListener(eventDef1, handler1);
    eventManager.addListener(eventDef2, handler2);

    await eventManager.emit(eventDef1, "data1", "test");

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).not.toHaveBeenCalled();
  });

  it("should handle asynchronous handlers", async () => {
    const results: number[] = [];

    eventManager.addListener(
      eventDefinition,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        results.push(1);
      },
      { order: 1 },
    );

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push(0);
      },
      { order: 0 },
    );

    await eventManager.emit(eventDefinition, "testData", "test");

    expect(results).toEqual([0, 1]);
  });

  it("parallel listeners aggregate errors with listener ids", async () => {
    const parallelEvent = defineEvent<string>({
      id: "parallel",
      parallel: true,
    });
    const results: string[] = [];

    eventManager.addListener(
      parallelEvent,
      () => {
        results.push("ok-1");
      },
      { order: 0, id: "l1" },
    );

    eventManager.addListener(
      parallelEvent,
      () => {
        throw new Error("boom-1");
      },
      { order: 0, id: "l2" },
    );

    eventManager.addListener(
      parallelEvent,
      () => {
        throw new Error("boom-2");
      },
      { order: 0, id: "l3" },
    );

    eventManager.addListener(
      parallelEvent,
      () => {
        results.push("should-not-run");
      },
      { order: 1, id: "later" },
    );

    await expect(
      eventManager.emit(parallelEvent, "data", "src"),
    ).rejects.toMatchObject({
      name: "AggregateError",
    });

    results.sort();
    expect(results).toEqual(["ok-1"]);

    try {
      await eventManager.emit(parallelEvent, "data", "src");
    } catch (err: any) {
      expect(err.name).toBe("AggregateError");
      expect(Array.isArray(err.errors)).toBe(true);
      expect(err.errors.map((e: any) => e.listenerId)).toEqual(
        expect.arrayContaining(["l2", "l3"]),
      );
      expect(err.errors.map((e: any) => e.listenerOrder)).toEqual([0, 0]);
      expect(err.errors[0]).toBeInstanceOf(Error);
    }
  });

  it("single parallel error is annotated with listener id", async () => {
    const parallelEvent = defineEvent<string>({
      id: "parallel-single",
      parallel: true,
    });

    eventManager.addListener(
      parallelEvent,
      () => {
        throw new Error("solo-bang");
      },
      { order: 0, id: "solo" },
    );

    try {
      await eventManager.emit(parallelEvent, "data", "src");
    } catch (err: any) {
      expect(err.listenerId).toBe("solo");
      expect(err.listenerOrder).toBe(0);
      expect(err.message).toBe("solo-bang");
    }
  });

  it("annotates non-object thrown values with listener metadata", async () => {
    const parallelEvent = defineEvent<string>({
      id: "parallel-nonobj",
      parallel: true,
    });

    eventManager.addListener(
      parallelEvent,
      () => {
        throw "primitive-error";
      },
      { order: 0, id: "primitive" },
    );

    await expect(
      eventManager.emit(parallelEvent, "data", "src"),
    ).rejects.toMatchObject({
      listenerId: "primitive",
      listenerOrder: 0,
      message: "primitive-error",
    });
  });

  it("should handle handler throwing an error", async () => {
    const handler = jest.fn().mockImplementation(() => {
      throw new Error("Handler error");
    });

    eventManager.addListener(eventDefinition, handler);

    await expect(
      eventManager.emit(eventDefinition, "testData", "test"),
    ).rejects.toThrow("Handler error");
  });

  it("should continue calling other handlers if one fails", async () => {
    const handler1 = jest.fn().mockImplementation(() => {
      throw new Error("Handler error");
    });
    const handler2 = jest.fn();

    eventManager.addListener(eventDefinition, handler1);
    eventManager.addListener(eventDefinition, handler2);

    await expect(
      eventManager.emit(eventDefinition, "testData", "test"),
    ).rejects.toThrow("Handler error");

    // The second handler should have been called despite the error in the first
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it("should not allow modification after lock", () => {
    const handler = jest.fn();
    eventManager.addListener(eventDefinition, handler);
    eventManager.lock();

    expect(() => {
      eventManager.addListener(eventDefinition, handler);
    }).toThrow("Cannot modify the EventManager when it is locked.");
  });

  it("should not throw when emitting after lock", async () => {
    const handler = jest.fn();
    eventManager.addListener(eventDefinition, handler);
    eventManager.lock();

    await expect(
      eventManager.emit(eventDefinition, "testData", "test"),
    ).resolves.toBeUndefined();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should correctly merge global and event listeners with same order", async () => {
    const results: string[] = [];

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push("eventListener");
      },
      { order: 1 },
    );

    eventManager.addGlobalListener(
      () => {
        results.push("globalListener");
      },
      { order: 1 },
    );

    await eventManager.emit(eventDefinition, "testData", "test");

    // According to the merge logic, event listeners come before global listeners when orders are equal
    expect(results).toEqual(["eventListener", "globalListener"]);
  });

  it("should handle filters in global listeners", async () => {
    const handler = jest.fn();
    const filter = (event: IEventEmission<string>) => event.data === "allowed";

    eventManager.addGlobalListener(handler, { filter });

    await eventManager.emit(eventDefinition, "blocked", "test");
    expect(handler).not.toHaveBeenCalled();

    await eventManager.emit(eventDefinition, "allowed", "test");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("should skip listener when listener id equals source", async () => {
    const handler = jest.fn();

    eventManager.addListener(eventDefinition, handler, { id: "self" } as any);

    // When the source equals the listener id, the listener should be skipped
    await eventManager.emit(eventDefinition, "data", "self");
    expect(handler).not.toHaveBeenCalled();

    // When source is different, it should be called
    await eventManager.emit(eventDefinition, "data", "other");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("hasListeners returns false when only global listeners exist but event is tagged excludeFromGlobalHooks", () => {
    const handler = jest.fn();
    eventManager.addGlobalListener(handler);

    const taggedEvent = defineEvent<string>({
      id: "taggedForHas",
      tags: [globalTags.excludeFromGlobalHooks],
    });

    expect(eventManager.hasListeners(taggedEvent)).toBe(false);
  });

  it("should handle emitting with no listeners", async () => {
    await expect(
      eventManager.emit(eventDefinition, "testData", "test"),
    ).resolves.toBeUndefined();
  });

  it("should handle listeners with no data", async () => {
    const handler = jest.fn();

    const voidEventDefinition = defineEvent<void>({ id: "voidEvent" });

    eventManager.addListener(voidEventDefinition, handler);

    await eventManager.emit(voidEventDefinition, undefined, "test");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "voidEvent",
        data: undefined,
        timestamp: expect.any(Date),
      }),
    );
  });

  describe("Performance Optimizations", () => {
    it("should cache merged listeners for repeated emits", async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      eventManager.addListener(eventDefinition, handler1, { order: 1 });
      eventManager.addGlobalListener(handler2, { order: 2 });

      // First emit should build cache
      await eventManager.emit(eventDefinition, "test1", "source");
      // Second emit should use cache
      await eventManager.emit(eventDefinition, "test2", "source");

      expect(handler1).toHaveBeenCalledTimes(2);
      expect(handler2).toHaveBeenCalledTimes(2);
    });

    it("should invalidate cache when adding event listeners", async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const handler3 = jest.fn();

      eventManager.addListener(eventDefinition, handler1, { order: 2 });
      await eventManager.emit(eventDefinition, "test1", "source");

      // Add new listener - should invalidate cache for this event
      eventManager.addListener(eventDefinition, handler2, { order: 1 });
      eventManager.addGlobalListener(handler3, { order: 3 });

      await eventManager.emit(eventDefinition, "test2", "source");

      expect(handler1).toHaveBeenCalledTimes(2);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler3).toHaveBeenCalledTimes(1);
    });

    it("should invalidate all caches when adding global listeners", async () => {
      const event1 = defineEvent<string>({ id: "event1" });
      const event2 = defineEvent<string>({ id: "event2" });

      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const globalHandler = jest.fn();

      eventManager.addListener(event1, handler1);
      eventManager.addListener(event2, handler2);

      // Emit to build caches
      await eventManager.emit(event1, "test1", "source");
      await eventManager.emit(event2, "test2", "source");

      // Add global listener - should invalidate all caches
      eventManager.addGlobalListener(globalHandler);

      // Emit again - global handler should be called
      await eventManager.emit(event1, "test3", "source");
      await eventManager.emit(event2, "test4", "source");

      expect(globalHandler).toHaveBeenCalledTimes(2);
    });

    it("should optimize for empty listener scenarios", async () => {
      const emptyEventDef = defineEvent<string>({ id: "emptyEvent" });

      // Should return immediately without creating event object
      await eventManager.emit(emptyEventDef, "test", "source");

      // No errors should occur
      expect(true).toBe(true);
    });

    it("should handle high-frequency emissions efficiently", async () => {
      const handler = jest.fn();
      eventManager.addListener(eventDefinition, handler);
      eventManager.addGlobalListener(jest.fn());

      const emitCount = 1000;
      const startTime = Date.now();

      for (let i = 0; i < emitCount; i++) {
        await eventManager.emit(eventDefinition, `test${i}`, "source");
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(handler).toHaveBeenCalledTimes(emitCount);
      // Should complete reasonably fast (adjust threshold as needed)
      expect(duration).toBeLessThan(5000); // 5 seconds max for 1000 emissions
    });

    it("should efficiently handle mixed event and global listeners", async () => {
      const results: string[] = [];

      // Add many listeners with different orders
      for (let i = 0; i < 10; i++) {
        eventManager.addListener(
          eventDefinition,
          () => results.push(`event${i}`),
          { order: i * 2 },
        );
        eventManager.addGlobalListener(() => results.push(`global${i}`), {
          order: i * 2 + 1,
        });
      }

      await eventManager.emit(eventDefinition, "test", "source");

      // Should maintain correct order and call all listeners
      expect(results).toHaveLength(20);
      expect(results[0]).toBe("event0");
      expect(results[1]).toBe("global0");
      expect(results[18]).toBe("event9");
      expect(results[19]).toBe("global9");
    });

    it("should reuse cached results across different event types", async () => {
      const event1 = defineEvent<string>({ id: "event1" });
      const event2 = defineEvent<string>({ id: "event2" });

      const handler1 = jest.fn();
      const handler2 = jest.fn();
      const globalHandler = jest.fn();

      eventManager.addListener(event1, handler1);
      eventManager.addListener(event2, handler2);
      eventManager.addGlobalListener(globalHandler);

      // Multiple emits should use cached merged listeners
      await eventManager.emit(event1, "test1", "source");
      await eventManager.emit(event2, "test2", "source");
      await eventManager.emit(event1, "test3", "source");
      await eventManager.emit(event2, "test4", "source");

      expect(handler1).toHaveBeenCalledTimes(2);
      expect(handler2).toHaveBeenCalledTimes(2);
      expect(globalHandler).toHaveBeenCalledTimes(4);
    });
  });

  it("should stop propagation when stopPropagation is called", async () => {
    const results: string[] = [];

    const firstHandler = jest.fn((event: IEventEmission<string>) => {
      results.push("first");
      expect(event.isPropagationStopped()).toBe(false);
      event.stopPropagation();
      expect(event.isPropagationStopped()).toBe(true);
    });

    const secondHandler = jest.fn(() => {
      results.push("second");
    });

    const globalHandler = jest.fn(() => {
      results.push("global");
    });

    eventManager.addListener(eventDefinition, firstHandler, { order: 1 });
    eventManager.addListener(eventDefinition, secondHandler, { order: 2 });
    eventManager.addGlobalListener(globalHandler, { order: 3 });

    await eventManager.emit(eventDefinition, "data", "test");

    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(secondHandler).not.toHaveBeenCalled();
    expect(globalHandler).not.toHaveBeenCalled();
    expect(results).toEqual(["first"]);
  });

  it("hasListeners returns false when no listeners are registered", () => {
    const emptyEvent = defineEvent<string>({ id: "noListenersEvent" });

    expect(eventManager.hasListeners(emptyEvent)).toBe(false);
  });

  it("hasListeners returns false for an event that has no listeners while others do", () => {
    const targetEvent = defineEvent<string>({ id: "targetEvent" });
    const otherEvent = defineEvent<string>({ id: "otherEvent" });

    eventManager.addListener(otherEvent, jest.fn());

    expect(eventManager.hasListeners(targetEvent)).toBe(false);
  });

  it("hasListeners returns true when event listeners are registered", () => {
    const handler = jest.fn();
    eventManager.addListener(eventDefinition, handler);
    expect(eventManager.hasListeners(eventDefinition)).toBe(true);
  });

  it("validates payload with schema: success and failure", async () => {
    const schemaEvent = defineEvent<any>({
      id: "schema.event",
      payloadSchema: {
        parse: (data: any) => {
          if (!data || typeof data.x !== "number") {
            throw new Error("Invalid");
          }
          return data;
        },
      },
    });
    const ok = jest.fn();
    eventManager.addListener(schemaEvent, ok);
    await expect(
      eventManager.emit(schemaEvent, { x: 1 }, "src"),
    ).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalled();

    await expect(
      eventManager.emit(schemaEvent, { x: "nope" } as any, "src"),
    ).rejects.toThrow(/Event payload/i);
  });

  it("wraps non-Error thrown by payload schema into ValidationError", async () => {
    const schemaEvent = defineEvent<any>({
      id: "schema.event.nonError",
      payloadSchema: {
        parse: (_data: any) => {
          throw "String error";
        },
      },
    });

    await expect(
      eventManager.emit(schemaEvent, { whatever: true }, "src"),
    ).rejects.toThrow(/Event payload/);
  });

  it("hasListeners returns true when only global listeners exist and event has empty array", () => {
    const handler = jest.fn();
    eventManager.addGlobalListener(handler);
    (eventManager as any).listeners.set(eventDefinition.id, []);
    expect(eventManager.hasListeners(eventDefinition)).toBe(true);
  });

  describe("interceptEmission", () => {
    it("should add emission interceptors", () => {
      const interceptor1 = jest.fn(async (next, event) => next(event));
      const interceptor2 = jest.fn(async (next, event) => next(event));

      eventManager.intercept(interceptor1);
      eventManager.intercept(interceptor2);

      expect((eventManager as any).emissionInterceptors).toHaveLength(2);
      expect((eventManager as any).emissionInterceptors[0]).toBe(interceptor1);
      expect((eventManager as any).emissionInterceptors[1]).toBe(interceptor2);
    });

    it("should throw error when adding interceptors after lock", () => {
      const interceptor = jest.fn(async (next, event) => next(event));
      eventManager.lock();

      expect(() => eventManager.intercept(interceptor)).toThrow("EventManager");
    });

    it("should execute interceptors in reverse order (LIFO)", async () => {
      const executionOrder: string[] = [];
      const interceptor1 = jest.fn(async (next, event) => {
        executionOrder.push("interceptor1");
        await next(event);
        executionOrder.push("interceptor1-end");
      });
      const interceptor2 = jest.fn(async (next, event) => {
        executionOrder.push("interceptor2");
        await next(event);
        executionOrder.push("interceptor2-end");
      });

      eventManager.intercept(interceptor1);
      eventManager.intercept(interceptor2);

      const handler = jest.fn();
      eventManager.addListener(eventDefinition, handler);

      await eventManager.emit(eventDefinition, "test", "source");

      expect(executionOrder).toEqual([
        "interceptor1",
        "interceptor2",
        "interceptor2-end",
        "interceptor1-end",
      ]);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should allow interceptors to modify events", async () => {
      const interceptor = jest.fn(async (next, event) => {
        const modifiedEvent = { ...event, data: `${event.data}-modified` };
        return next(modifiedEvent);
      });

      eventManager.intercept(interceptor);

      const handler = jest.fn();
      eventManager.addListener(eventDefinition, handler);

      await eventManager.emit(eventDefinition, "original", "source");

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: "original-modified",
        }),
      );
    });

    it("should allow interceptors to prevent emission", async () => {
      const interceptor = jest.fn(async (next, event) => {
        // Don't call next, preventing emission
        return Promise.resolve();
      });

      eventManager.intercept(interceptor);

      const handler = jest.fn();
      eventManager.addListener(eventDefinition, handler);

      await eventManager.emit(eventDefinition, "test", "source");

      expect(handler).not.toHaveBeenCalled();
      expect(interceptor).toHaveBeenCalledTimes(1);
    });

    it("should work with multiple interceptors preventing emission", async () => {
      const interceptor1 = jest.fn(async (next, event) => {
        // Call next but interceptor2 will prevent emission
        return next(event);
      });
      const interceptor2 = jest.fn(async (next, event) => {
        // Don't call next, preventing emission
        return Promise.resolve();
      });

      eventManager.intercept(interceptor1);
      eventManager.intercept(interceptor2);

      const handler = jest.fn();
      eventManager.addListener(eventDefinition, handler);

      await eventManager.emit(eventDefinition, "test", "source");

      expect(handler).not.toHaveBeenCalled();
      expect(interceptor1).toHaveBeenCalledTimes(1);
      expect(interceptor2).toHaveBeenCalledTimes(1);
    });
  });

  describe("emitWithResult", () => {
    it("returns final payload after interceptor and listener mutations", async () => {
      eventManager.intercept(async (next, event) => {
        return next({ ...event, data: `${event.data}-i` });
      });

      eventManager.addListener(eventDefinition, async (e) => {
        e.data = `${e.data}-l`;
      });

      const out = await eventManager.emitWithResult(
        eventDefinition,
        "orig",
        "src",
      );
      expect(out).toBe("orig-i-l");
    });

    it("returns payload even when interceptors short-circuit emission", async () => {
      eventManager.intercept(async (next, event) => {
        return next({ ...event, data: "deep" });
      });
      eventManager.intercept(async () => {
        // Prevent base emission
        return;
      });

      const handler = jest.fn();
      eventManager.addListener(eventDefinition, handler);

      const out = await eventManager.emitWithResult(
        eventDefinition,
        "orig",
        "src",
      );
      expect(handler).not.toHaveBeenCalled();
      expect(out).toBe("deep");
    });
  });

  describe("interceptHook", () => {
    it("should add hook interceptors", () => {
      const interceptor1 = jest.fn(async (next, hook, event) =>
        next(hook, event),
      );
      const interceptor2 = jest.fn(async (next, hook, event) =>
        next(hook, event),
      );

      eventManager.interceptHook(interceptor1);
      eventManager.interceptHook(interceptor2);

      expect((eventManager as any).hookInterceptors).toHaveLength(2);
      expect((eventManager as any).hookInterceptors[0]).toBe(interceptor1);
      expect((eventManager as any).hookInterceptors[1]).toBe(interceptor2);
    });

    it("should throw error when adding hook interceptors after lock", () => {
      const interceptor = jest.fn(async (next, hook, event) =>
        next(hook, event),
      );
      eventManager.lock();

      expect(() => eventManager.interceptHook(interceptor)).toThrow(
        "EventManager",
      );
    });
  });

  describe("executeHookWithInterceptors", () => {
    it("should execute hook without interceptors", async () => {
      const mockHook = {
        id: "testHook",
        run: jest.fn().mockResolvedValue("hookResult"),
      };

      const mockEvent = {
        id: "testEvent",
        data: "testData",
        timestamp: new Date(),
        source: "testSource",
        tags: [],
      };

      const result = await eventManager.executeHookWithInterceptors(
        mockHook as any,
        mockEvent as any,
        {},
      );

      expect(result).toBe("hookResult");
      expect(mockHook.run).toHaveBeenCalledWith(mockEvent, {});
    });

    it("should execute hook interceptors in reverse order (LIFO)", async () => {
      const executionOrder: string[] = [];
      const interceptor1 = jest.fn(async (next, hook, event) => {
        executionOrder.push("interceptor1");
        const result = await next(hook, event);
        executionOrder.push("interceptor1-end");
        return result;
      });
      const interceptor2 = jest.fn(async (next, hook, event) => {
        executionOrder.push("interceptor2");
        const result = await next(hook, event);
        executionOrder.push("interceptor2-end");
        return result;
      });

      eventManager.interceptHook(interceptor1);
      eventManager.interceptHook(interceptor2);

      const mockHook = {
        id: "testHook",
        run: jest.fn().mockResolvedValue("hookResult"),
      };

      const mockEvent = {
        id: "testEvent",
        data: "testData",
        timestamp: new Date(),
        source: "testSource",
        tags: [],
      };

      await eventManager.executeHookWithInterceptors(
        mockHook as any,
        mockEvent as any,
        {},
      );

      expect(executionOrder).toEqual([
        "interceptor1",
        "interceptor2",
        "interceptor2-end",
        "interceptor1-end",
      ]);
    });

    it("should allow hook interceptors to modify hook or event", async () => {
      const interceptor = jest.fn(async (next, hook, event) => {
        const modifiedEvent = { ...event, data: `${event.data}-modified` };
        return next(hook, modifiedEvent);
      });

      eventManager.interceptHook(interceptor);

      const mockHook = {
        id: "testHook",
        run: jest.fn().mockResolvedValue("hookResult"),
      };

      const mockEvent = {
        id: "testEvent",
        data: "original",
        timestamp: new Date(),
        source: "testSource",
        tags: [],
      };

      await eventManager.executeHookWithInterceptors(
        mockHook as any,
        mockEvent as any,
        {},
      );

      expect(mockHook.run).toHaveBeenCalledWith(
        expect.objectContaining({ data: "original-modified" }),
        {},
      );
    });

    it("should allow hook interceptors to prevent hook execution", async () => {
      const interceptor = jest.fn(async (next, hook, event) => {
        // Don't call next, preventing hook execution
        return "interceptorResult";
      });

      eventManager.interceptHook(interceptor);

      const mockHook = {
        id: "testHook",
        run: jest.fn().mockResolvedValue("hookResult"),
      };

      const mockEvent = {
        id: "testEvent",
        data: "testData",
        timestamp: new Date(),
        source: "testSource",
        tags: [],
      };

      const result = await eventManager.executeHookWithInterceptors(
        mockHook as any,
        mockEvent as any,
        {},
      );

      expect(result).toBe("interceptorResult");
      expect(mockHook.run).not.toHaveBeenCalled();
    });

    it("executes hook directly when event is tagged excludeFromGlobalHooks (observability)", async () => {
      const mockHook = {
        id: "observHook",
        run: jest.fn().mockResolvedValue("ok"),
      };

      const mockEvent = {
        id: "evt",
        data: "x",
        timestamp: new Date(),
        source: "s",
        meta: {},
        stopPropagation: () => {},
        isPropagationStopped: () => false,
        tags: [globalTags.excludeFromGlobalHooks],
      } as any;

      const result = await eventManager.executeHookWithInterceptors(
        mockHook as any,
        mockEvent as any,
        {},
      );

      expect(result).toBe("ok");
      expect(mockHook.run).toHaveBeenCalledWith(mockEvent, {});
    });

    it("rethrows errors from hook.run in non-observability case", async () => {
      const mockHook = {
        id: "failingHook",
        run: jest.fn().mockRejectedValue(new Error("boom")),
      };

      const mockEvent = {
        id: "evt",
        data: "x",
        timestamp: new Date(),
        source: "s",
        meta: {},
        stopPropagation: () => {},
        isPropagationStopped: () => false,
        tags: [],
      } as any;

      await expect(
        eventManager.executeHookWithInterceptors(
          mockHook as any,
          mockEvent as any,
          {},
        ),
      ).rejects.toThrow("boom");
      expect(mockHook.run).toHaveBeenCalled();
    });

    it("executes hook directly when runtimeCycleDetection is false", async () => {
      const em = new EventManager({ runtimeCycleDetection: false });
      const mockHook = {
        id: "noContextHook",
        run: jest.fn().mockResolvedValue("ok-no-context"),
      } as any;

      const mockEvent = {
        id: "evt",
        data: "x",
        timestamp: new Date(),
        source: "s",
        tags: [],
      } as any;

      const result = await em.executeHookWithInterceptors(
        mockHook,
        mockEvent,
        {},
      );

      expect(result).toBe("ok-no-context");
      expect(mockHook.run).toHaveBeenCalledWith(mockEvent, {});
    });
  });

  describe("integration with emit", () => {
    it("should handle empty interceptors gracefully", async () => {
      const handler = jest.fn();
      eventManager.addListener(eventDefinition, handler);

      await eventManager.emit(eventDefinition, "test", "source");

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should handle interceptors that throw errors", async () => {
      const interceptor = jest.fn(async (next, event) => {
        throw new Error("Interceptor error");
      });

      eventManager.intercept(interceptor);

      const handler = jest.fn();
      eventManager.addListener(eventDefinition, handler);

      await expect(
        eventManager.emit(eventDefinition, "test", "source"),
      ).rejects.toThrow("Interceptor error");
      expect(handler).not.toHaveBeenCalled();
    });

    it("should handle hook interceptors that throw errors", async () => {
      const interceptor = jest.fn(async (next, hook, event) => {
        throw new Error("Hook interceptor error");
      });

      eventManager.interceptHook(interceptor);

      const mockHook = {
        id: "testHook",
        run: jest.fn().mockResolvedValue("hookResult"),
      };

      const mockEvent = {
        id: "testEvent",
        data: "testData",
        timestamp: new Date(),
        source: "testSource",
        tags: [],
      };

      await expect(
        eventManager.executeHookWithInterceptors(
          mockHook as any,
          mockEvent as any,
          {},
        ),
      ).rejects.toThrow("Hook interceptor error");
      expect(mockHook.run).not.toHaveBeenCalled();
    });
  });

  it("should exclude global listeners when event has excludeFromGlobalHooks tag", async () => {
    const { globalTags } = await import("../../globals/globalTags");
    const handlerEvent = jest.fn();
    const handlerGlobal = jest.fn();

    const taggedEvent = defineEvent<string>({
      id: "taggedEvent",
      tags: [globalTags.excludeFromGlobalHooks],
    });

    eventManager.addListener(taggedEvent, handlerEvent);
    eventManager.addGlobalListener(handlerGlobal);

    await eventManager.emit(taggedEvent, "data", "test");

    expect(handlerEvent).toHaveBeenCalledTimes(1);
    expect(handlerGlobal).not.toHaveBeenCalled();
  });

  it("should not call global listeners when event is tagged and has no event-specific listeners", async () => {
    const handlerGlobal = jest.fn();
    eventManager.addGlobalListener(handlerGlobal);

    const taggedEvent = defineEvent<string>({
      id: "taggedNoSpecific",
      tags: [globalTags.excludeFromGlobalHooks],
    });

    // Emit should ignore global listeners for this tagged event
    await eventManager.emit(taggedEvent, "data", "src");

    expect(handlerGlobal).not.toHaveBeenCalled();
    expect(eventManager.hasListeners(taggedEvent)).toBe(false);
  });

  it("should still run emission interceptors for events tagged excludeFromGlobalHooks", async () => {
    const taggedEvent = defineEvent<string>({
      id: "observ.event",
      tags: [globalTags.excludeFromGlobalHooks],
    });

    const executionOrder: string[] = [];
    const interceptor = jest.fn(async (next, event) => {
      executionOrder.push("interceptor");
      await next(event);
      executionOrder.push("interceptor-end");
    });

    const handlerEvent = jest.fn(() => executionOrder.push("event-listener"));
    const handlerGlobal = jest.fn(() => executionOrder.push("global-listener"));

    eventManager.intercept(interceptor);
    eventManager.addListener(taggedEvent, handlerEvent);
    eventManager.addGlobalListener(handlerGlobal);

    await eventManager.emit(taggedEvent, "data", "src");

    expect(interceptor).toHaveBeenCalledTimes(1);
    expect(handlerEvent).toHaveBeenCalledTimes(1);
    expect(handlerGlobal).not.toHaveBeenCalled();
    expect(executionOrder).toEqual([
      "interceptor",
      "event-listener",
      "interceptor-end",
    ]);
  });

  it("uses only event-specific listeners when excludeFromGlobal is set (avoids merging)", async () => {
    const spy = jest.spyOn(eventManager as any, "getCachedMergedListeners");

    const handlerEvent = jest.fn();
    const handlerGlobal = jest.fn();

    const taggedEvent = defineEvent<string>({
      id: "taggedMergeCheck",
      tags: [globalTags.excludeFromGlobalHooks],
    });

    eventManager.addListener(taggedEvent, handlerEvent);
    eventManager.addGlobalListener(handlerGlobal);

    await eventManager.emit(taggedEvent, "data", "src");

    expect(handlerEvent).toHaveBeenCalledTimes(1);
    expect(handlerGlobal).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it("exposes getCachedMergedListeners for backward compatibility", () => {
    const manager = new EventManager();
    const registry = (manager as any).registry;
    const spy = jest.spyOn(registry, "getCachedMergedListeners");

    (manager as any).getCachedMergedListeners("evt-bc");

    expect(spy).toHaveBeenCalledWith("evt-bc");
  });

  it("should still run hook interceptors for events tagged excludeFromGlobalHooks", async () => {
    const executionOrder: string[] = [];
    const hookInterceptor = jest.fn(async (next, hook, event) => {
      executionOrder.push("hook-interceptor");
      const result = await next(hook, event);
      executionOrder.push("hook-interceptor-end");
      return result;
    });

    eventManager.interceptHook(hookInterceptor);

    const mockHook = {
      id: "observHook",
      run: jest.fn(async () => {
        executionOrder.push("hook-run");
        return "ok";
      }),
    } as any;

    const mockEvent = {
      id: "evt",
      data: "x",
      timestamp: new Date(),
      source: "s",
      meta: {},
      stopPropagation: () => {},
      isPropagationStopped: () => false,
      tags: [globalTags.excludeFromGlobalHooks],
    } as any;

    const result = await eventManager.executeHookWithInterceptors(
      mockHook,
      mockEvent,
      {},
    );

    expect(result).toBe("ok");
    expect(hookInterceptor).toHaveBeenCalledTimes(1);
    expect(mockHook.run).toHaveBeenCalledWith(mockEvent, {});
    expect(executionOrder).toEqual([
      "hook-interceptor",
      "hook-run",
      "hook-interceptor-end",
    ]);
  });

  // Hook lifecycle events are no longer emitted by EventManager; related tests removed

  describe("cycle detection", () => {
    it("constructor default enables runtimeCycleDetection and throws on self-cycle", async () => {
      const em = new EventManager();
      const A = defineEvent<string>({ id: "A_default" });
      em.addListener(A, async () => {
        await em.emit(A, "x", "listener-A");
      });

      await expect(em.emit(A, "init", "test")).rejects.toThrow();
    });

    it("safe re-emit by same hook does not throw", async () => {
      const em = new EventManager({ runtimeCycleDetection: true });
      const A = defineEvent<string>({ id: "A_hook" });

      const hook = {
        id: "hook-1",
        run: async (event: any) => {
          // only re-emit once for the initial event to avoid infinite recursion
          if (event && event.data === "start") {
            await em.emit(A, "from-hook", "hook-1");
          }
          return undefined;
        },
      } as any;

      em.addListener(A, async (event) => {
        // Execute hook within currentHookIdContext via executeHookWithInterceptors
        await em.executeHookWithInterceptors(hook, event, {} as any);
      });

      // Initial emit should not throw because re-emit is from the same hook id
      await expect(em.emit(A, "start", "origin")).resolves.toBeUndefined();
    });
    it("throws on direct self-cycle (A -> A)", async () => {
      const A = defineEvent<string>({ id: "A" });
      eventManager.addListener(A, async () => {
        await eventManager.emit(A, "x", "listener-A");
      });

      await expect(eventManager.emit(A, "init", "test")).rejects.toThrow();
    });

    it("throws on cross-cycle (A -> B -> A)", async () => {
      const A = defineEvent<string>({ id: "A" });
      const B = defineEvent<string>({ id: "B" });

      eventManager.addListener(A, async () => {
        await eventManager.emit(B, "x", "listener-A");
      });
      eventManager.addListener(B, async () => {
        await eventManager.emit(A, "y", "listener-B");
      });

      await expect(eventManager.emit(A, "init", "test")).rejects.toThrow();
    });

    it("allows acyclic chains (A -> B -> C)", async () => {
      const calls: string[] = [];
      const A = defineEvent<string>({ id: "A" });
      const B = defineEvent<string>({ id: "B" });
      const C = defineEvent<string>({ id: "C" });

      eventManager.addListener(A, async () => {
        calls.push("A");
        await eventManager.emit(B, "x", "listener-A");
      });
      eventManager.addListener(B, async () => {
        calls.push("B");
        await eventManager.emit(C, "y", "listener-B");
      });
      eventManager.addListener(C, async () => {
        calls.push("C");
      });

      await expect(
        eventManager.emit(A, "init", "test"),
      ).resolves.toBeUndefined();
      expect(calls).toEqual(["A", "B", "C"]);
    });

    it("does not throw when runtimeCycleDetection is false (A -> B -> A)", async () => {
      const calls: string[] = [];
      const max = 2;
      const A = defineEvent<{ count: number }>({ id: "A_disabled" });
      const B = defineEvent<{ count: number }>({ id: "B_disabled" });

      const em = new EventManager({ runtimeCycleDetection: false });

      em.addListener(A, async (event) => {
        calls.push("A");
        if (event.data.count < max) {
          await em.emit(B, { count: event.data.count + 1 }, "listener-A");
        }
      });

      em.addListener(B, async (event) => {
        calls.push("B");
        if (event.data.count < max) {
          await em.emit(A, { count: event.data.count + 1 }, "listener-B");
        }
      });

      await expect(em.emit(A, { count: 0 }, "test")).resolves.toBeUndefined();
      expect(calls).toEqual(["A", "B", "A"]);
    });
  });
});
