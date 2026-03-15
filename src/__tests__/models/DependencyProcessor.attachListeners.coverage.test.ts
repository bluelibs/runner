import { defineEvent, defineHook, defineResource } from "../../define";
import { DependencyProcessor } from "../../models/DependencyProcessor";
import { ResourceLifecycleMode } from "../../types/runner";
import { createTestFixture } from "../test-utils";

describe("DependencyProcessor attachListeners coverage", () => {
  it("fails fast when an array hook references a canonically resolved event missing from the store map", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const firstEvent = defineEvent({
      id: "dp-attach-array-first-event",
    });
    const missingEvent = defineEvent({
      id: "dp-attach-array-missing-event",
    });
    const hook = defineHook({
      id: "dp-attach-array-hook",
      on: [firstEvent, missingEvent],
      async run() {},
    });

    store.storeGenericItem(firstEvent);
    store.storeGenericItem(missingEvent);
    store.storeGenericItem(hook);

    const firstEventId = store.findIdByDefinition(firstEvent);
    const missingEventId = store.findIdByDefinition(missingEvent);
    const originalFindIdByDefinition = store.findIdByDefinition.bind(store);
    jest.spyOn(store, "findIdByDefinition").mockImplementation((reference) => {
      if (reference === firstEvent) {
        return firstEventId;
      }
      if (reference === missingEvent) {
        return missingEventId;
      }

      return originalFindIdByDefinition(reference);
    });
    jest.spyOn(store.events, "get").mockImplementation((eventId) => {
      if (eventId === missingEventId) {
        return undefined;
      }

      return Map.prototype.get.call(store.events, eventId);
    });

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceLifecycleMode.Sequential,
    );

    expect(() => processor.attachListeners()).toThrow(
      /Event "dp-attach-array-missing-event" not found\./,
    );
  });

  it("fails fast when a single hook event resolves canonically but is missing from the store map", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    const missingEvent = defineEvent({
      id: "dp-attach-single-missing-event",
    });
    const hook = defineHook({
      id: "dp-attach-single-hook",
      on: missingEvent,
      async run() {},
    });

    store.storeGenericItem(missingEvent);
    store.storeGenericItem(hook);

    const missingEventId = store.findIdByDefinition(missingEvent);
    const originalFindIdByDefinition = store.findIdByDefinition.bind(store);
    jest.spyOn(store, "findIdByDefinition").mockImplementation((reference) => {
      if (reference === missingEvent) {
        return missingEventId;
      }

      return originalFindIdByDefinition(reference);
    });
    jest.spyOn(store.events, "get").mockImplementation((eventId) => {
      if (eventId === missingEventId) {
        return undefined;
      }

      return Map.prototype.get.call(store.events, eventId);
    });

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceLifecycleMode.Sequential,
    );

    expect(() => processor.attachListeners()).toThrow(
      /Event "dp-attach-single-missing-event" not found\./,
    );
  });

  it("covers the hook branch where `on` is undefined", () => {
    const fixture = createTestFixture();
    const { store, eventManager, logger } = fixture;
    const taskRunner = fixture.createTaskRunner();
    store.setTaskRunner(taskRunner);

    store.root = {
      resource: defineResource({ id: "dp-attach-no-on-root" }),
      config: undefined,
      value: undefined,
      context: {},
      isInitialized: false,
    } as never;

    store.hooks.set("dp-attach-no-on-hook", {
      hook: {
        id: "dp-attach-no-on-hook",
        on: undefined,
        dependencies: {},
      },
      isInitialized: true,
    } as never);

    const processor = new DependencyProcessor(
      store,
      eventManager,
      taskRunner,
      logger,
      ResourceLifecycleMode.Sequential,
    );
    const addListenerSpy = jest.spyOn(eventManager, "addListener");
    const addGlobalListenerSpy = jest.spyOn(eventManager, "addGlobalListener");

    processor.attachListeners();

    expect(addListenerSpy).not.toHaveBeenCalled();
    expect(addGlobalListenerSpy).not.toHaveBeenCalled();
  });
});
