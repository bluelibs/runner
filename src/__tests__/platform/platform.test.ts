/**
 * Simple test to verify platform abstraction works in different environments
 */
import {
  getPlatform,
  setPlatform,
  resetPlatform,
  PlatformAdapter,
  detectEnvironment,
  getDetectedEnvironment,
  isNode,
  isBrowser,
  isUniversal,
  isEdge,
} from "../../platform";

describe("Platform Abstraction", () => {
  afterEach(() => {
    resetPlatform(); // Reset to auto-detection after each test
  });

  it("should auto-detect Node.js platform", () => {
    const platform = getPlatform();
    expect(platform.getEnv("NODE_ENV")).toBeDefined();
  });

  it("should handle error listeners gracefully", () => {
    const universalAdapter = new PlatformAdapter("universal");
    setPlatform(universalAdapter);

    const platform = getPlatform();

    const cleanup = platform.onUncaughtException(() => {});

    // Should not throw
    expect(() => cleanup()).not.toThrow();
  });

  it("should handle shutdown signals gracefully", () => {
    const universalAdapter = new PlatformAdapter("universal");
    setPlatform(universalAdapter);

    const platform = getPlatform();

    const cleanup = platform.onShutdownSignal(() => {});

    // Should not throw
    expect(() => cleanup()).not.toThrow();
  });

  it("should throw for unsupported exit in universal environment", () => {
    const universalAdapter = new PlatformAdapter("universal");
    setPlatform(universalAdapter);

    const platform = getPlatform();

    // Universal platforms cannot exit the process; should throw
    expect(() => platform.exit(0)).toThrow();
  });

  it("should handle manual platform override", () => {
    const customAdapter = new PlatformAdapter("universal");
    setPlatform(customAdapter);

    const platform = getPlatform();
    expect(platform).toBe(customAdapter);

    resetPlatform();
    const autoDetected = getPlatform();
    expect(autoDetected).not.toBe(customAdapter);
  });

  it("should handle universal platform edge cases", () => {
    const universalAdapter = new PlatformAdapter("universal");
    setPlatform(universalAdapter);

    const platform = getPlatform();

    // Test getEnv with fallbacks
    expect(platform.getEnv("NONEXISTENT_VAR")).toBeUndefined();

    // Test unhandled rejection handling
    const cleanupRejection = platform.onUnhandledRejection(() => {});
    expect(() => cleanupRejection()).not.toThrow();

    // Test timeout methods
    const timeoutId = platform.setTimeout(() => {}, 1);
    expect(() => platform.clearTimeout(timeoutId)).not.toThrow();
  });

  it("should handle Node.js platform features", () => {
    const nodeAdapter = new PlatformAdapter("node");
    setPlatform(nodeAdapter);

    const platform = getPlatform();

    // Test Node.js specific features
    expect(platform.getEnv("PATH")).toBeDefined();

    // Test error handling setup/cleanup
    const cleanupError = platform.onUncaughtException(() => {});
    expect(typeof cleanupError).toBe("function");

    const cleanupRejection = platform.onUnhandledRejection(() => {});
    expect(typeof cleanupRejection).toBe("function");

    // Test shutdown signal handling
    const cleanupShutdown = platform.onShutdownSignal(() => {});
    expect(typeof cleanupShutdown).toBe("function");

    // Clean up listeners
    cleanupError();
    cleanupRejection();
    cleanupShutdown();
  });

  it("should test universal adapter environment variable fallbacks", () => {
    const universalAdapter = new PlatformAdapter("universal");

    expect(() => {
      universalAdapter.createAsyncLocalStorage<string>();
    }).not.toThrow();

    // Test __ENV__ fallback
    Object.defineProperty(globalThis, "__ENV__", {
      value: { TEST_VAR: "env_value" },
      configurable: true,
    });
    expect(universalAdapter.getEnv("TEST_VAR")).toBe("env_value");
    delete (globalThis as any).__ENV__;

    // Test process.env fallback
    const originalProcess = (globalThis as any).process;
    Object.defineProperty(globalThis, "process", {
      value: { env: { TEST_VAR: "process_value" } },
      configurable: true,
    });
    expect(universalAdapter.getEnv("TEST_VAR")).toBe("process_value");

    // Test env fallback
    Object.defineProperty(globalThis, "process", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(globalThis, "env", {
      value: { TEST_VAR: "global_value" },
      configurable: true,
    });
    expect(universalAdapter.getEnv("TEST_VAR")).toBe("global_value");
    delete (globalThis as any).env;
    if (originalProcess) {
      Object.defineProperty(globalThis, "process", {
        value: originalProcess,
        configurable: true,
      });
    } else {
      delete (globalThis as any).process;
    }

    // Test undefined when no env found
    expect(universalAdapter.getEnv("TEST_VAR")).toBeUndefined();
  });

  it("should test universal adapter event listener safety", () => {
    const universalAdapter = new PlatformAdapter("universal");

    // Test when addEventListener is not available
    const originalAddEventListener = (globalThis as any).addEventListener;
    delete (globalThis as any).addEventListener;

    expect(() => {
      const cleanup = universalAdapter.onUncaughtException(() => {});
      cleanup();
    }).not.toThrow();

    expect(() => {
      const cleanup = universalAdapter.onUnhandledRejection(() => {});
      cleanup();
    }).not.toThrow();

    expect(() => {
      const cleanup = universalAdapter.onShutdownSignal(() => {});
      cleanup();
    }).not.toThrow();

    // Restore
    (globalThis as any).addEventListener = originalAddEventListener;
  });

  it("should test visibilitychange listener behavior", () => {
    const universalAdapter = new PlatformAdapter("universal");

    // Mock document and addEventListener
    const originalDocument = (globalThis as any).document;
    const originalAddEventListener = (globalThis as any).addEventListener;

    let visibilityListener: (() => void) | undefined;
    const mockAddEventListener = jest.fn(
      (event: string, listener: () => void) => {
        if (event === "visibilitychange") {
          visibilityListener = listener;
        }
      },
    );

    (globalThis as any).addEventListener = mockAddEventListener;
    (globalThis as any).document = { visibilityState: "visible" };

    let shutdownCalled = false;
    const cleanup = universalAdapter.onShutdownSignal(() => {
      shutdownCalled = true;
    });

    expect(mockAddEventListener).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
    expect(mockAddEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );

    // Test visibilitychange with hidden state
    (globalThis as any).document.visibilityState = "hidden";
    if (visibilityListener) {
      visibilityListener();
    }

    expect(shutdownCalled).toBe(true);

    // Clean up
    cleanup();

    // Restore
    (globalThis as any).document = originalDocument;
    (globalThis as any).addEventListener = originalAddEventListener;
  });

  it("should test Node.js platform exit method (mocked)", () => {
    // Only test if we're in a Node.js environment
    if (typeof process !== "undefined" && typeof process.exit === "function") {
      const nodeAdapter = new PlatformAdapter("node");

      // Mock process.exit to capture the call
      const exitSpy = jest.fn();
      const exitMock = jest
        .spyOn(process, "exit")
        .mockImplementation(exitSpy as any);

      try {
        nodeAdapter.exit(1);
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        // Restore original
        exitMock.mockRestore();
      }
    } else {
      // Skip test in non-Node.js environments
      expect(true).toBe(true);
    }
  });

  it("should test Node.js platform onShutdownSignal method", () => {
    // Only test if we're in a Node.js environment
    if (typeof process !== "undefined" && typeof process.on === "function") {
      const nodeAdapter = new PlatformAdapter("node");

      const handler = jest.fn();
      const cleanup = nodeAdapter.onShutdownSignal(handler);

      // Verify cleanup function is returned
      expect(typeof cleanup).toBe("function");

      // Clean up
      cleanup();
    } else {
      // Skip test in non-Node.js environments
      expect(true).toBe(true);
    }
  });

  it("should test Node.js platform getEnv method", () => {
    // Only test if we're in a Node.js environment
    if (typeof process !== "undefined" && process.env) {
      const nodeAdapter = new PlatformAdapter("node");

      // Set a test environment variable
      process.env.TEST_PLATFORM_VAR = "test-value";

      // Test getting an existing env var
      expect(nodeAdapter.getEnv("TEST_PLATFORM_VAR")).toBe("test-value");

      // Test getting a non-existent env var
      expect(nodeAdapter.getEnv("NON_EXISTENT_VAR")).toBeUndefined();

      // Clean up
      delete process.env.TEST_PLATFORM_VAR;
    } else {
      // Skip test in non-Node.js environments
      expect(true).toBe(true);
    }
  });

  it("should test Node.js platform createAsyncLocalStorage method", async () => {
    const nodeAdapter = new PlatformAdapter("node");
    await nodeAdapter.init(); // Ensure initialization

    // Test creating AsyncLocalStorage
    const als = nodeAdapter.createAsyncLocalStorage<string>();

    // Test that it has the expected interface
    expect(als).toHaveProperty("getStore");
    expect(als).toHaveProperty("run");
    expect(typeof als.getStore).toBe("function");
    expect(typeof als.run).toBe("function");

    // Test that it works
    let capturedValue: string | undefined;
    als.run("test-store-value", () => {
      capturedValue = als.getStore();
    });

    expect(capturedValue).toBe("test-store-value");

    // Test outside of run context
    expect(als.getStore()).toBeUndefined();
  });

  it("should trigger error handler when error event fires in universal adapter", () => {
    const universalAdapter = new PlatformAdapter("universal");

    let capturedListener: any;
    const originalAddEventListener = (globalThis as any).addEventListener;
    (globalThis as any).addEventListener = (evt: string, fn: Function) => {
      if (evt === "error") capturedListener = fn;
    };

    let handlerCalled = false;
    let capturedError: any;
    universalAdapter.onUncaughtException((error) => {
      handlerCalled = true;
      capturedError = error;
    });

    const testError = new Error("universal test error");
    const errorEvent = { error: testError };
    capturedListener(errorEvent);

    expect(handlerCalled).toBe(true);
    expect(capturedError).toBe(testError);

    (globalThis as any).addEventListener = originalAddEventListener;
  });

  it("should trigger rejection handler when unhandledrejection event fires in universal adapter", () => {
    const universalAdapter = new PlatformAdapter("universal");

    let capturedListener: any;
    const originalAddEventListener = (globalThis as any).addEventListener;
    (globalThis as any).addEventListener = (evt: string, fn: Function) => {
      if (evt === "unhandledrejection") capturedListener = fn;
    };

    let handlerCalled = false;
    let capturedReason: any;
    universalAdapter.onUnhandledRejection((reason) => {
      handlerCalled = true;
      capturedReason = reason;
    });

    const testReason = "universal test rejection reason";
    const rejectionEvent = { reason: testReason };
    capturedListener(rejectionEvent);

    expect(handlerCalled).toBe(true);
    expect(capturedReason).toBe(testReason);

    (globalThis as any).addEventListener = originalAddEventListener;
  });

  it("should trigger beforeunload shutdown handler in universal adapter", () => {
    const universalAdapter = new PlatformAdapter("universal");

    let capturedBeforeUnloadListener: any;
    const originalAddEventListener = (globalThis as any).addEventListener;
    (globalThis as any).addEventListener = (evt: string, fn: Function) => {
      if (evt === "beforeunload") capturedBeforeUnloadListener = fn;
    };

    let handlerCalled = false;
    universalAdapter.onShutdownSignal(() => {
      handlerCalled = true;
    });

    capturedBeforeUnloadListener();

    expect(handlerCalled).toBe(true);

    (globalThis as any).addEventListener = originalAddEventListener;
  });

  // NEW TESTS FOR 100% COVERAGE

  it("should test detectEnvironment universal path", () => {
    // Mock environment to force universal detection
    const originalWindow = (globalThis as any).window;
    const originalDocument = (globalThis as any).document;
    const originalProcess = (globalThis as any).process;

    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).process;

    expect(detectEnvironment()).toBe("universal");

    // Restore
    (globalThis as any).window = originalWindow;
    (globalThis as any).document = originalDocument;
    (globalThis as any).process = originalProcess;
  });

  it("should test PlatformAdapter constructor with explicit env", () => {
    const adapter = new PlatformAdapter("browser");
    expect(adapter.env).toBe("browser");
  });

  it("should test hasAsyncLocalStorage universal case", () => {
    const universalAdapter = new PlatformAdapter("universal");
    expect(universalAdapter.hasAsyncLocalStorage()).toBe(false);
  });

  it("should test createAsyncLocalStorage browser case", () => {
    const browserAdapter = new PlatformAdapter("browser");
    expect(() => browserAdapter.createAsyncLocalStorage()).not.toThrow();
  });

  it("should test utility functions", () => {
    // Test getDetectedEnvironment
    const env = getDetectedEnvironment();
    expect(["node", "browser", "universal"]).toContain(env);

    // Test utility functions based on detected environment
    if (env === "node") {
      expect(isNode()).toBe(true);
      expect(isBrowser()).toBe(false);
      expect(isUniversal()).toBe(false);
    } else if (env === "browser") {
      expect(isNode()).toBe(false);
      expect(isBrowser()).toBe(true);
      expect(isUniversal()).toBe(false);
    } else {
      expect(isNode()).toBe(false);
      expect(isBrowser()).toBe(false);
      expect(isUniversal()).toBe(true);
    }
  });

  it("should test onShutdownSignal universal cleanup", () => {
    const universalAdapter = new PlatformAdapter("universal");

    // Mock addEventListener to track calls
    const originalAddEventListener = (globalThis as any).addEventListener;
    const mockAddEventListener = jest.fn();
    (globalThis as any).addEventListener = mockAddEventListener;

    const cleanup = universalAdapter.onShutdownSignal(() => {});
    expect(typeof cleanup).toBe("function");

    // Call cleanup and verify it doesn't throw
    expect(() => cleanup()).not.toThrow();

    // Restore
    (globalThis as any).addEventListener = originalAddEventListener;
  });

  // Tests for platform/types.ts utility functions
  describe("Platform Type Utilities", () => {
    it("should test isNode utility", () => {
      // Mock Node.js environment
      const originalProcess = (globalThis as any).process;
      (globalThis as any).process = { versions: { node: "18.0.0" } };

      expect(isNode()).toBe(true);

      // Mock non-Node.js environment
      delete (globalThis as any).process;
      expect(isNode()).toBe(false);

      // Restore
      (globalThis as any).process = originalProcess;
    });

    it("should test isBrowser utility", () => {
      // Mock browser environment
      const originalWindow = (globalThis as any).window;
      const originalDocument = (globalThis as any).document;
      (globalThis as any).window = {};
      (globalThis as any).document = {};

      expect(isBrowser()).toBe(true);

      // Mock non-browser environment
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      expect(isBrowser()).toBe(false);

      // Restore
      (globalThis as any).window = originalWindow;
      (globalThis as any).document = originalDocument;
    });

    it("should test isEdge utility in worker-like environments", () => {
      // Mock edge/worker environment
      const originalSelf = (globalThis as any).self;
      const originalImportScripts = (globalThis as any).importScripts;
      const originalWindow = (globalThis as any).window;
      const originalProcess = (globalThis as any).process;
      (globalThis as any).self = {};
      (globalThis as any).importScripts = () => {};
      delete (globalThis as any).window;
      delete (globalThis as any).process;

      expect(isEdge()).toBe(true);

      // Mock non-worker environment
      delete (globalThis as any).self;
      delete (globalThis as any).importScripts;
      expect(isEdge()).toBe(false);

      // Restore
      (globalThis as any).self = originalSelf;
      (globalThis as any).importScripts = originalImportScripts;
      (globalThis as any).window = originalWindow;
      (globalThis as any).process = originalProcess;
    });

    it("should work with require when module is cjs", async () => {
      const originalValue = (global as any).__BUILD_FORMAT__;
      (global as any).__BUILD_FORMAT__ = "cjs";

      const platform = new PlatformAdapter("node");
      await expect(platform.init()).resolves.toBe(undefined);

      (global as any).__BUILD_FORMAT__ = originalValue;
    });

    it("should work with require when module is mjs", async () => {
      const originalValue = (global as any).__BUILD_FORMAT__;
      (global as any).__BUILD_FORMAT__ = "mjs";

      const platform = new PlatformAdapter("node");
      await expect(platform.init()).resolves.toBe(undefined);

      (global as any).__BUILD_FORMAT__ = originalValue;
    });

    it("should test isUniversal utility", () => {
      // Mock universal environment (no Node.js, no browser, no WebWorker)
      (globalThis as any).process;
      (globalThis as any).window;
      (globalThis as any).document;
      (globalThis as any).self;
      const originalImportScripts = (globalThis as any).importScripts;

      delete (globalThis as any).process;
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      delete (globalThis as any).self;
      delete (globalThis as any).importScripts;

      expect(isUniversal()).toBe(true);

      // Mock Node.js environment
      (globalThis as any).process = { versions: { node: "18.0.0" } };
      expect(isUniversal()).toBe(false);

      // Mock browser environment
      delete (globalThis as any).process;
      (globalThis as any).window = {};
      (globalThis as any).document = {};
      expect(isUniversal()).toBe(false);

      // Mock WebWorker environment
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      (globalThis as any).self = {};
      (globalThis as any).importScripts = () => {};
      expect(isUniversal()).toBe(false);

      // Restore
      (globalThis as any).importScripts = originalImportScripts;
    });
  });
});
