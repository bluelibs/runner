import { PlatformUnsupportedFunction } from "../errors";
/**
 * Simple test to verify platform abstraction works in different environments
 */
import {
  getPlatform,
  setPlatform,
  resetPlatform,
  UniversalPlatformAdapter,
  NodePlatformAdapter,
} from "../platform";

describe("Platform Abstraction", () => {
  afterEach(() => {
    resetPlatform(); // Reset to auto-detection after each test
  });

  it("should auto-detect Node.js platform", () => {
    const platform = getPlatform();
    expect(platform.getEnv("NODE_ENV")).toBeDefined();
  });

  it("should handle error listeners gracefully", () => {
    const universalAdapter = new UniversalPlatformAdapter();
    setPlatform(universalAdapter);

    const platform = getPlatform();

    let errorCaught = false;
    const cleanup = platform.onUncaughtException(() => {
      errorCaught = true;
    });

    // Should not throw
    expect(() => cleanup()).not.toThrow();
  });

  it("should handle shutdown signals gracefully", () => {
    const universalAdapter = new UniversalPlatformAdapter();
    setPlatform(universalAdapter);

    const platform = getPlatform();

    let shutdownCalled = false;
    const cleanup = platform.onShutdownSignal(() => {
      shutdownCalled = true;
    });

    // Should not throw
    expect(() => cleanup()).not.toThrow();
  });

  it("should throw for unsupported exit in universal environment", () => {
    const universalAdapter = new UniversalPlatformAdapter();
    setPlatform(universalAdapter);

    const platform = getPlatform();

    // Universal platforms cannot exit the process; should throw
    expect(() => platform.exit(0)).toThrow();
  });

  it("should handle manual platform override", () => {
    const customAdapter = new UniversalPlatformAdapter();
    setPlatform(customAdapter);

    const platform = getPlatform();
    expect(platform).toBe(customAdapter);

    resetPlatform();
    const autoDetected = getPlatform();
    expect(autoDetected).not.toBe(customAdapter);
  });

  it("should handle universal platform edge cases", () => {
    const universalAdapter = new UniversalPlatformAdapter();
    setPlatform(universalAdapter);

    const platform = getPlatform();

    // Test getEnv with fallbacks
    expect(platform.getEnv("NONEXISTENT_VAR")).toBeUndefined();

    // Test unhandled rejection handling
    let rejectionCaught = false;
    const cleanupRejection = platform.onUnhandledRejection(() => {
      rejectionCaught = true;
    });
    expect(() => cleanupRejection()).not.toThrow();

    // Test timeout methods
    const timeoutId = platform.setTimeout(() => {}, 1);
    expect(() => platform.clearTimeout(timeoutId)).not.toThrow();
  });

  it("should handle Node.js platform features", () => {
    const nodeAdapter = new NodePlatformAdapter();
    setPlatform(nodeAdapter);

    const platform = getPlatform();

    // Test Node.js specific features
    expect(platform.getEnv("PATH")).toBeDefined();

    // Test error handling setup/cleanup
    let errorHandled = false;
    const cleanupError = platform.onUncaughtException(() => {
      errorHandled = true;
    });
    expect(typeof cleanupError).toBe("function");

    let rejectionHandled = false;
    const cleanupRejection = platform.onUnhandledRejection(() => {
      rejectionHandled = true;
    });
    expect(typeof cleanupRejection).toBe("function");

    // Test shutdown signal handling
    let shutdownHandled = false;
    const cleanupShutdown = platform.onShutdownSignal(() => {
      shutdownHandled = true;
    });
    expect(typeof cleanupShutdown).toBe("function");

    // Clean up listeners
    cleanupError();
    cleanupRejection();
    cleanupShutdown();
  });

  it("should handle platform detection without Node.js", () => {
    // Temporarily hide Node.js globals
    const originalProcess = (globalThis as any).process;
    const originalRequire = (globalThis as any).require;

    delete (globalThis as any).process;
    delete (globalThis as any).require;

    resetPlatform(); // Force re-detection

    const platform = getPlatform();
    expect(platform).toBeInstanceOf(UniversalPlatformAdapter);

    // Restore globals
    (globalThis as any).process = originalProcess;
    (globalThis as any).require = originalRequire;
  });

  it("should test universal adapter environment variable fallbacks", () => {
    const universalAdapter = new UniversalPlatformAdapter();

    // Test with simulated environment variables
    const originalGlobalThis = globalThis;

    expect(() => {
      universalAdapter.createAsyncLocalStorage<string>();
    }).toThrow(PlatformUnsupportedFunction);

    // Test __ENV__ fallback
    (globalThis as any).__ENV__ = { TEST_VAR: "env_value" };
    expect(universalAdapter.getEnv("TEST_VAR")).toBe("env_value");
    delete (globalThis as any).__ENV__;

    // Test process.env fallback
    (globalThis as any).process = { env: { TEST_VAR: "process_value" } };
    expect(universalAdapter.getEnv("TEST_VAR")).toBe("process_value");
    delete (globalThis as any).process;

    // Test env fallback
    (globalThis as any).env = { TEST_VAR: "global_value" };
    expect(universalAdapter.getEnv("TEST_VAR")).toBe("global_value");
    delete (globalThis as any).env;

    // Test undefined when no env found
    expect(universalAdapter.getEnv("TEST_VAR")).toBeUndefined();
  });

  it("should test universal adapter event listener safety", () => {
    const universalAdapter = new UniversalPlatformAdapter();

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
    const universalAdapter = new UniversalPlatformAdapter();

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
    if (typeof process !== "undefined" && process.exit) {
      const nodeAdapter = new NodePlatformAdapter();
      const originalExit = process.exit;

      // Mock process.exit to capture the call
      const exitSpy = jest.fn();
      process.exit = exitSpy as any;

      try {
        nodeAdapter.exit(1);
        expect(exitSpy).toHaveBeenCalledWith(1);
      } finally {
        // Restore original
        process.exit = originalExit;
      }
    } else {
      // Skip test in non-Node.js environments
      expect(true).toBe(true);
    }
  });

  it("should test Node.js platform onShutdownSignal method", () => {
    // Only test if we're in a Node.js environment
    if (typeof process !== "undefined" && typeof process.on === "function") {
      const nodeAdapter = new NodePlatformAdapter();

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
      const nodeAdapter = new NodePlatformAdapter();

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

  it("should test Node.js platform createAsyncLocalStorage method", () => {
    const nodeAdapter = new NodePlatformAdapter();

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
    const universalAdapter = new UniversalPlatformAdapter();

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
    const universalAdapter = new UniversalPlatformAdapter();

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
    const universalAdapter = new UniversalPlatformAdapter();

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
});
