import { IEvent, IEventDefinition } from "../../defs";
import { Errors } from "../../errors";
import { EventManager } from "../../models/EventManager";

describe("EventManager", () => {
  let eventManager: EventManager;
  let eventDefinition: IEventDefinition<string>;

  beforeEach(() => {
    eventManager = new EventManager();
    eventDefinition = { id: "testEvent" };
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
    const filter = (event: IEvent<string>) => event.data === "allowed";

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
    const eventDef1: IEventDefinition<string> = { id: "event1" };
    const eventDef2: IEventDefinition<string> = { id: "event2" };

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
    const eventDef1: IEventDefinition<string> = { id: "event1" };
    const eventDef2: IEventDefinition<string> = { id: "event2" };

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
    const eventDef1: IEventDefinition<string> = { id: "event1" };
    const eventDef2: IEventDefinition<string> = { id: "event2" };

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
    const filter = (event: IEvent<string>) => event.data === "allowed";

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

    const voidEventDefinition: IEventDefinition<void> = { id: "voidEvent" };

    eventManager.addListener(voidEventDefinition, handler);

    await eventManager.emit(voidEventDefinition, undefined, "test");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "voidEvent",
        data: undefined,
      })
    );
  });
});
