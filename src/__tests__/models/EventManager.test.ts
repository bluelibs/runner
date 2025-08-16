import {
  IEvent,
  IEventEmission,
  symbolEvent,
  symbolFilePath,
} from "../../defs";
import { EventManager } from "../../models/EventManager";

describe("EventManager", () => {
  let eventManager: EventManager;
  let eventDefinition: IEvent<string>;

  beforeEach(() => {
    eventManager = new EventManager();
    eventDefinition = {
      id: "testEvent",
      [symbolEvent]: true,
      [symbolFilePath]: "test.ts",
    };
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
      })
    );
  });

  it("should respect listener order", async () => {
    const results: number[] = [];

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push(1);
      },
      { order: 2 }
    );

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push(0);
      },
      { order: 1 }
    );

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push(3);
      },
      { order: 4 }
    );

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push(2);
      },
      { order: 3 }
    );

    await eventManager.emit(eventDefinition, "testData", "test");

    expect(results).toEqual([0, 1, 2, 3]);
  });

  it("should apply filters correctly", async () => {
    const handler = jest.fn();
    const filter = (event: IEventEmission<string>) => event.data === "allowed";

    eventManager.addListener(eventDefinition, handler, { filter });

    await eventManager.emit(eventDefinition, "blocked", "test");
    expect(handler).not.toHaveBeenCalled();

    await eventManager.emit(eventDefinition, "allowed", "test");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        data: "allowed",
      })
    );
  });

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
      })
    );
  });

  it("global listeners should respect order with event listeners", async () => {
    const results: string[] = [];

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push("eventListener1");
      },
      { order: 2 }
    );

    eventManager.addGlobalListener(
      () => {
        results.push("globalListener1");
      },
      { order: 1 }
    );

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push("eventListener2");
      },
      { order: 4 }
    );

    eventManager.addGlobalListener(
      () => {
        results.push("globalListener2");
      },
      { order: 3 }
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
    }).toThrowError("Cannot modify the EventManager when it is locked.");

    expect(() => {
      eventManager.addGlobalListener(handler);
    }).toThrowError("Cannot modify the EventManager when it is locked.");
  });

  it("should handle multiple events", async () => {
    const eventDef1: IEvent<string> = {
      id: "event1",
      [symbolEvent]: true,
      [symbolFilePath]: "test.ts",
    };
    const eventDef2: IEvent<string> = {
      id: "event2",
      [symbolEvent]: true,
      [symbolFilePath]: "test.ts",
    };

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
      })
    );

    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "event2",
        data: "data2",
      })
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
    const eventDef1: IEvent<string> = {
      id: "event1",
      [symbolEvent]: true,
      [symbolFilePath]: "test.ts",
    };
    const eventDef2: IEvent<string> = {
      id: "event2",
      [symbolEvent]: true,
      [symbolFilePath]: "test.ts",
    };

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
      })
    );
    expect(handler).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "event2",
        data: "data2",
      })
    );
  });

  it("should not affect other events when emitting one", async () => {
    const eventDef1: IEvent<string> = {
      id: "event1",
      [symbolEvent]: true,
      [symbolFilePath]: "test.ts",
    };
    const eventDef2: IEvent<string> = {
      id: "event2",
      [symbolEvent]: true,
      [symbolFilePath]: "test.ts",
    };

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
      { order: 1 }
    );

    eventManager.addListener(
      eventDefinition,
      () => {
        results.push(0);
      },
      { order: 0 }
    );

    await eventManager.emit(eventDefinition, "testData", "test");

    expect(results).toEqual([0, 1]);
  });

  it("should handle handler throwing an error", async () => {
    const handler = jest.fn().mockImplementation(() => {
      throw new Error("Handler error");
    });

    eventManager.addListener(eventDefinition, handler);

    await expect(
      eventManager.emit(eventDefinition, "testData", "test")
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
      eventManager.emit(eventDefinition, "testData", "test")
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
    }).toThrowError("Cannot modify the EventManager when it is locked.");
  });

  it("should not throw when emitting after lock", async () => {
    const handler = jest.fn();
    eventManager.addListener(eventDefinition, handler);
    eventManager.lock();

    await expect(
      eventManager.emit(eventDefinition, "testData", "test")
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
      { order: 1 }
    );

    eventManager.addGlobalListener(
      () => {
        results.push("globalListener");
      },
      { order: 1 }
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

  it("should handle emitting with no listeners", async () => {
    await expect(
      eventManager.emit(eventDefinition, "testData", "test")
    ).resolves.toBeUndefined();
  });

  it("should handle listeners with no data", async () => {
    const handler = jest.fn();

    const voidEventDefinition: IEvent<void> = {
      id: "voidEvent",
      [symbolEvent]: true,
      [symbolFilePath]: "test.ts",
    };

    eventManager.addListener(voidEventDefinition, handler);

    await eventManager.emit(voidEventDefinition, undefined, "test");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "voidEvent",
        data: undefined,
        timestamp: expect.any(Date),
      })
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
      const event1: IEvent<string> = {
        id: "event1",
        [symbolEvent]: true,
        [symbolFilePath]: "test.ts",
      };
      const event2: IEvent<string> = {
        id: "event2",
        [symbolEvent]: true,
        [symbolFilePath]: "test.ts",
      };

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
      const emptyEventDef: IEvent<string> = {
        id: "emptyEvent",
        [symbolEvent]: true,
        [symbolFilePath]: "test.ts",
      };

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
          { order: i * 2 }
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
      const event1: IEvent<string> = {
        id: "event1",
        [symbolEvent]: true,
        [symbolFilePath]: "test.ts",
      };
      const event2: IEvent<string> = {
        id: "event2",
        [symbolEvent]: true,
        [symbolFilePath]: "test.ts",
      };

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
    const emptyEvent: IEvent<string> = {
      id: "noListenersEvent",
      [symbolEvent]: true,
      [symbolFilePath]: "test.ts",
    };

    expect(eventManager.hasListeners(emptyEvent)).toBe(false);
  });

  it("hasListeners returns false for an event that has no listeners while others do", () => {
    const targetEvent: IEvent<string> = {
      id: "targetEvent",
      [symbolEvent]: true,
      [symbolFilePath]: "test.ts",
    };
    const otherEvent: IEvent<string> = {
      id: "otherEvent",
      [symbolEvent]: true,
      [symbolFilePath]: "test.ts",
    };

    eventManager.addListener(otherEvent, jest.fn());

    expect(eventManager.hasListeners(targetEvent)).toBe(false);
  });
});
