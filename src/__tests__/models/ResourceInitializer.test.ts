import { ResourceInitializer } from "../../models/ResourceInitializer";
import { Store } from "../../models/Store";
import { EventManager } from "../../models/EventManager";
import { defineResource } from "../../define";
import { Logger, OnUnhandledError } from "../../models";
import { RunnerMode } from "../../types/runner";

describe("ResourceInitializer", () => {
  let store: Store;
  let eventManager: EventManager;
  let logger: Logger;
  let resourceInitializer: ResourceInitializer;
  let onUnhandledError: OnUnhandledError;

  beforeEach(() => {
    eventManager = new EventManager({ runtimeCycleDetection: true });
    logger = new Logger({
      printThreshold: "info",
      printStrategy: "pretty",
      bufferLogs: false,
    });
    onUnhandledError = jest.fn();
    store = new Store(eventManager, logger, onUnhandledError, RunnerMode.TEST);
    resourceInitializer = new ResourceInitializer(store, eventManager, logger);
  });

  it("should initialize a resource", async () => {
    const mockResource = defineResource({
      id: "testResource",
      init: jest.fn().mockResolvedValue("initialized value"),
    });

    const mockConfig = undefined;
    const mockDependencies = {};

    const result = await resourceInitializer.initializeResource(
      mockResource,
      mockConfig,
      mockDependencies,
    );

    expect(result).toEqual({ value: "initialized value", context: undefined });
    expect(mockResource.init).toHaveBeenCalledWith(
      mockConfig,
      mockDependencies,
      undefined,
    );

    // No lifecycle events anymore
  });

  it("should throw errors from resource init", async () => {
    const mockError = new Error("Initialization error");
    const mockResource = defineResource({
      id: "testResource",
      init: jest.fn().mockRejectedValue(mockError),
    });

    const mockConfig = undefined;
    const mockDependencies = {};

    await expect(
      resourceInitializer.initializeResource(
        mockResource,
        mockConfig,
        mockDependencies,
      ),
    ).rejects.toThrow(mockError);
    expect(mockResource.init).toHaveBeenCalledWith(
      mockConfig,
      mockDependencies,
      undefined,
    );
  });

  it("should handle resources without init function", async () => {
    const mockResource = defineResource<number>({
      id: "testResource",
    });

    const mockConfig = 42;
    const mockDependencies = {};

    const result = await resourceInitializer.initializeResource(
      mockResource,
      mockConfig,
      mockDependencies,
    );

    expect(result).toEqual({ value: undefined, context: undefined });
    // No lifecycle events anymore
  });
});
