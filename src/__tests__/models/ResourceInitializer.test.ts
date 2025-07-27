import { ResourceInitializer } from "../../models/ResourceInitializer";
import { Store } from "../../models/Store";
import { EventManager } from "../../models/EventManager";
import { defineResource } from "../../define";
import { Logger } from "../../models";
import { globalResources } from "../../globalResources";
import { globalEvents } from "../../globalEvents";

describe("ResourceInitializer", () => {
  let store: Store;
  let eventManager: EventManager;
  let logger: Logger;
  let resourceInitializer: ResourceInitializer;

  beforeEach(() => {
    eventManager = new EventManager();
    logger = new Logger(eventManager);
    store = new Store(eventManager, logger);
    resourceInitializer = new ResourceInitializer(store, eventManager, logger);
  });

  it("should initialize a resource and emit events", async () => {
    const mockResource = defineResource({
      id: "testResource",
      init: jest.fn().mockResolvedValue("initialized value"),
    });

    const mockConfig = undefined;
    const mockDependencies = {};

    const emitSpy = jest.spyOn(eventManager, "emit");

    const result = await resourceInitializer.initializeResource(
      mockResource,
      mockConfig,
      mockDependencies
    );

    expect(result).toEqual({ value: "initialized value", context: undefined });
    expect(mockResource.init).toHaveBeenCalledWith(
      mockConfig,
      mockDependencies,
      undefined
    );

    expect(emitSpy).toHaveBeenCalledWith(
      globalEvents.resources.beforeInit,
      {
        config: mockConfig,
        resource: mockResource,
      },
      "testResource"
    );
    expect(emitSpy).toHaveBeenCalledWith(
      mockResource.events.beforeInit,
      {
        config: mockConfig,
      },
      "testResource"
    );
    expect(emitSpy).toHaveBeenCalledWith(
      mockResource.events.afterInit,
      {
        config: mockConfig,
        value: "initialized value",
      },
      "testResource"
    );
  });

  it("should handle errors and emit onError event", async () => {
    const mockError = new Error("Initialization error");
    const mockResource = defineResource({
      id: "testResource",
      init: jest.fn().mockRejectedValue(mockError),
    });

    const mockConfig = undefined;
    const mockDependencies = {};

    const emitSpy = jest.spyOn(eventManager, "emit");

    let result;
    try {
      result = await resourceInitializer.initializeResource(
        mockResource,
        mockConfig,
        mockDependencies
      );
    } catch (e) {}

    expect(result).toBeUndefined();
    expect(mockResource.init).toHaveBeenCalledWith(
      mockConfig,
      mockDependencies,
      undefined
    );
    expect(emitSpy).toHaveBeenCalledWith(
      mockResource.events.beforeInit,
      {
        config: mockConfig,
      },
      "testResource"
    );
    expect(emitSpy).toHaveBeenCalledWith(
      mockResource.events.onError,
      {
        error: mockError,
        suppress: expect.any(Function),
      },
      "testResource"
    );
  });

  it("should handle resources without init function", async () => {
    const mockResource = defineResource<number>({
      id: "testResource",
    });

    const mockConfig = 42;
    const mockDependencies = {};

    const emitSpy = jest.spyOn(eventManager, "emit");

    const result = await resourceInitializer.initializeResource(
      mockResource,
      mockConfig,
      mockDependencies
    );

    expect(result).toEqual({ value: undefined, context: undefined });
    expect(emitSpy).toHaveBeenCalledWith(
      mockResource.events.beforeInit,
      {
        config: mockConfig,
      },
      "testResource"
    );
    expect(emitSpy).toHaveBeenCalledWith(
      mockResource.events.afterInit,
      {
        config: mockConfig,
        value: undefined,
      },
      "testResource"
    );
  });
});
