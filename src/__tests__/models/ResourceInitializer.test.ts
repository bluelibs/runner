import { ResourceInitializer } from "../../models/ResourceInitializer";
import { Store } from "../../models/Store";
import { EventManager } from "../../models/EventManager";
import { defineResource } from "../../define";

describe("ResourceInitializer", () => {
  let store: Store;
  let eventManager: EventManager;
  let resourceInitializer: ResourceInitializer;

  beforeEach(() => {
    eventManager = new EventManager();
    store = new Store(eventManager);
    resourceInitializer = new ResourceInitializer(store, eventManager);
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

    expect(result).toBe("initialized value");
    expect(mockResource.init).toHaveBeenCalledWith(
      mockConfig,
      mockDependencies
    );
    expect(emitSpy).toHaveBeenCalledWith(mockResource.events.beforeInit, {
      config: mockConfig,
    });
    expect(emitSpy).toHaveBeenCalledWith(mockResource.events.afterInit, {
      config: mockConfig,
      value: "initialized value",
    });
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
      mockDependencies
    );
    expect(emitSpy).toHaveBeenCalledTimes(4);
    expect(emitSpy).toHaveBeenCalledWith(mockResource.events.beforeInit, {
      config: mockConfig,
    });
    expect(emitSpy).toHaveBeenCalledWith(mockResource.events.onError, {
      error: mockError,
      suppress: expect.any(Function),
    });
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

    expect(result).toBeUndefined();
    expect(emitSpy).toHaveBeenCalledTimes(4);
    expect(emitSpy).toHaveBeenCalledWith(mockResource.events.beforeInit, {
      config: mockConfig,
    });
    expect(emitSpy).toHaveBeenCalledWith(mockResource.events.afterInit, {
      config: mockConfig,
      value: undefined,
    });
  });
});
