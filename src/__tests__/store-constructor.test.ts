import { Store } from "../models/Store";
import { EventManager } from "../models/EventManager";
import { Logger } from "../models/Logger";
import { OnUnhandledError } from "../models/UnhandledError";
import { RunnerMode } from "../enums/RunnerMode";

describe("Store Mode Defaulting", () => {
  it("should auto-detect DEV mode when no mode is provided and NODE_ENV is not set", () => {
    // Temporarily clear NODE_ENV to test default behavior
    const originalEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    
    try {
      const eventManager = new EventManager();
      const logger = new Logger({
        printThreshold: null,
        printStrategy: "pretty",
        bufferLogs: false,
      });
      const onUnhandledError: OnUnhandledError = (e) => {
        throw e;
      };
      
      // Call Store constructor with 3 parameters to test the auto-detection fallback behavior
      const store = new Store(eventManager, logger, onUnhandledError);
      
      expect(store.mode).toBe(RunnerMode.DEV);
    } finally {
      // Restore original environment
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("should auto-detect TEST mode when no mode is provided and NODE_ENV is set to test", () => {
    // Set NODE_ENV to test
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    
    try {
      const eventManager = new EventManager();
      const logger = new Logger({
        printThreshold: null,
        printStrategy: "pretty",
        bufferLogs: false,
      });
      const onUnhandledError: OnUnhandledError = (e) => {
        throw e;
      };
      
      // Call Store constructor with 3 parameters to test the auto-detection fallback behavior
      const store = new Store(eventManager, logger, onUnhandledError);
      
      expect(store.mode).toBe(RunnerMode.TEST);
    } finally {
      // Restore original environment
      process.env.NODE_ENV = originalEnv;
    }
  });

  it("should use provided mode when passed to constructor (overriding environment)", () => {
    // Set NODE_ENV to test to verify that provided mode takes precedence
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    
    try {
      const eventManager = new EventManager();
      const logger = new Logger({
        printThreshold: null,
        printStrategy: "pretty",
        bufferLogs: false,
      });
      const onUnhandledError: OnUnhandledError = (e) => {
        throw e;
      };
      
      // Call Store constructor with 4 parameters to test the provided mode (should override env)
      const store = new Store(eventManager, logger, onUnhandledError, RunnerMode.PROD);
      
      expect(store.mode).toBe(RunnerMode.PROD);
    } finally {
      // Restore original environment
      process.env.NODE_ENV = originalEnv;
    }
  });
});