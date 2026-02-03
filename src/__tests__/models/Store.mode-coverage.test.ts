import { Store } from "../../models/Store";
import { EventManager } from "../../models/EventManager";
import { Logger } from "../../models/Logger";
import { OnUnhandledError } from "../../models/UnhandledError";
import { RunnerMode } from "../../types/runner";
import { setPlatform, resetPlatform } from "../../platform";
import { PlatformAdapter } from "../../platform";

describe("Store Mode Auto-Detection Branch Coverage", () => {
  beforeEach(() => {
    resetPlatform();
  });

  afterEach(() => {
    resetPlatform();
  });

  it("should detect all mode values correctly", () => {
    // Create a platform adapter for testing
    const mockAdapter = new PlatformAdapter();

    // Test PROD mode
    jest.spyOn(mockAdapter, "getEnv").mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "production";
      return undefined;
    });

    setPlatform(mockAdapter);

    const eventManager = new EventManager();
    const logger = new Logger({
      printThreshold: null,
      printStrategy: "pretty",
      bufferLogs: false,
    });
    const onUnhandledError: OnUnhandledError = (e) => {
      throw e;
    };

    let store = new Store(eventManager, logger, onUnhandledError);
    expect(store.mode).toBe(RunnerMode.PROD);

    // Test DEV mode
    jest.spyOn(mockAdapter, "getEnv").mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "development";
      return undefined;
    });

    store = new Store(eventManager, logger, onUnhandledError);
    expect(store.mode).toBe(RunnerMode.DEV);

    // Test TEST mode
    jest.spyOn(mockAdapter, "getEnv").mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "test";
      return undefined;
    });

    store = new Store(eventManager, logger, onUnhandledError);
    expect(store.mode).toBe(RunnerMode.TEST);

    // Test default mode (when NODE_ENV is something else)
    jest.spyOn(mockAdapter, "getEnv").mockImplementation((key: string) => {
      if (key === "NODE_ENV") return "staging"; // not one of the expected values
      return undefined;
    });

    store = new Store(eventManager, logger, onUnhandledError);
    expect(store.mode).toBe(RunnerMode.DEV);

    // Test when NODE_ENV is undefined
    jest.spyOn(mockAdapter, "getEnv").mockImplementation((key: string) => {
      if (key === "NODE_ENV") return undefined;
      return undefined;
    });

    store = new Store(eventManager, logger, onUnhandledError);
    expect(store.mode).toBe(RunnerMode.DEV);

    // Also test the explicit mode parameter path
    store = new Store(eventManager, logger, onUnhandledError, RunnerMode.PROD);
    expect(store.mode).toBe(RunnerMode.PROD);
  });
});
