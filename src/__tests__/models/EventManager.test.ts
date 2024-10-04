import { IEvent, IEventDefinition } from "../../defs";
import { Errors } from "../../errors";
import { EventManager } from "../../models/EventManager";

describe("EventManager", () => {
  let eventManager: EventManager;

  beforeEach(() => {
    eventManager = new EventManager();
  });

  const testEvent: IEventDefinition<string> = {
    id: "test-event",
  };

  const createEvent = (data: string): IEvent<string> => ({
    id: testEvent.id,
    data,
  });

  describe("emit", () => {
    it("should emit an event and call the appropriate listeners", async () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      eventManager.addListener(testEvent, listener1);
      eventManager.addListener(testEvent, listener2);

      await eventManager.emit(testEvent, "test data");

      expect(listener1).toHaveBeenCalledWith(createEvent("test data"));
      expect(listener2).toHaveBeenCalledWith(createEvent("test data"));
    });

    it("should respect the order of listeners", async () => {
      const calls: number[] = [];
      const listener1 = jest.fn(() => calls.push(1));
      const listener2 = jest.fn(() => calls.push(2));
      const listener3 = jest.fn(() => calls.push(3));

      eventManager.addListener(testEvent, listener2, { order: 2 });
      eventManager.addListener(testEvent, listener1, { order: 1 });
      eventManager.addListener(testEvent, listener3, { order: 3 });

      await eventManager.emit(testEvent, "test data");

      expect(calls).toEqual([1, 2, 3]);
    });

    it("should apply filters to listeners", async () => {
      const listener = jest.fn();
      const filter = jest.fn((event: IEvent<string>) => event.data === "pass");

      eventManager.addListener(testEvent, listener, { filter });

      await eventManager.emit(testEvent, "pass");
      await eventManager.emit(testEvent, "fail");

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(createEvent("pass"));
    });
  });

  describe("addListener", () => {
    it("should add a listener for a single event", () => {
      const listener = jest.fn();
      eventManager.addListener(testEvent, listener);

      // @ts-ignore: Accessing private property for testing
      expect(eventManager.listeners.get(testEvent.id)).toHaveLength(1);
    });

    it("should add a listener for multiple events", () => {
      const listener = jest.fn();
      const event1: IEventDefinition = { id: "event1" };
      const event2: IEventDefinition = { id: "event2" };

      eventManager.addListener([event1, event2], listener);

      // @ts-ignore: Accessing private property for testing
      expect(eventManager.listeners.get(event1.id)).toHaveLength(1);
      // @ts-ignore: Accessing private property for testing
      expect(eventManager.listeners.get(event2.id)).toHaveLength(1);
    });
  });

  describe("addGlobalListener", () => {
    it("should add a global listener", async () => {
      const globalListener = jest.fn();
      eventManager.addGlobalListener(globalListener);

      await eventManager.emit(testEvent, "test data");

      expect(globalListener).toHaveBeenCalledWith(createEvent("test data"));
    });
  });

  it("should lock the EventManager", () => {
    eventManager.lock();
    expect(eventManager.isLocked).toBe(true);

    expect(() => eventManager.checkLock()).toThrow(
      Errors.locked("EventManager")
    );

    expect(() => eventManager.addListener(testEvent, jest.fn())).toThrow(
      Errors.locked("EventManager")
    );

    expect(() => eventManager.addGlobalListener(jest.fn())).toThrow(
      Errors.locked("EventManager")
    );
  });
});
