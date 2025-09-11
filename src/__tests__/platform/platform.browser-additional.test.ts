import { BrowserPlatformAdapter } from "../../platform/adapters/browser";
import { PlatformUnsupportedFunction } from "../../errors";

describe("BrowserPlatformAdapter - Additional Coverage", () => {
  let adapter: BrowserPlatformAdapter;

  beforeEach(() => {
    adapter = new BrowserPlatformAdapter();
  });

  describe("getEnv", () => {
    const originalEnv = (globalThis as any).__ENV__;
    const originalProcess = (globalThis as any).process;
    const originalGlobalEnv = (globalThis as any).env;

    afterEach(() => {
      (globalThis as any).__ENV__ = originalEnv;
      (globalThis as any).process = originalProcess;
      (globalThis as any).env = originalGlobalEnv;
    });

    it("should return value from __ENV__ when available", () => {
      (globalThis as any).__ENV__ = { TEST_KEY: "from-env" };
      expect(adapter.getEnv("TEST_KEY")).toBe("from-env");
    });

    it("should return value from process.env when available and __ENV__ is not object", () => {
      (globalThis as any).__ENV__ = null;
      (globalThis as any).process = { env: { TEST_KEY: "from-process" } };
      expect(adapter.getEnv("TEST_KEY")).toBe("from-process");
    });

    it("should return value from globalThis.env when available", () => {
      delete (globalThis as any).__ENV__;
      delete (globalThis as any).process;
      (globalThis as any).env = { TEST_KEY: "from-global-env" };
      expect(adapter.getEnv("TEST_KEY")).toBe("from-global-env");
    });

    it("should return undefined when key is not found", () => {
      delete (globalThis as any).__ENV__;
      delete (globalThis as any).process;
      delete (globalThis as any).env;
      expect(adapter.getEnv("NONEXISTENT_KEY")).toBeUndefined();
    });

    it("should handle __ENV__ being non-object", () => {
      (globalThis as any).__ENV__ = "not-an-object";
      (globalThis as any).process = { env: { TEST_KEY: "from-process" } };
      expect(adapter.getEnv("TEST_KEY")).toBe("from-process");
    });

    it("should handle globalThis.env being non-object", () => {
      delete (globalThis as any).__ENV__;
      delete (globalThis as any).process;
      (globalThis as any).env = "not-an-object";
      expect(adapter.getEnv("TEST_KEY")).toBeUndefined();
    });
  });

  describe("onShutdownSignal - additional coverage", () => {
    const originalWindow = (globalThis as any).window;
    const originalDocument = (globalThis as any).document;

    afterEach(() => {
      (globalThis as any).window = originalWindow;
      (globalThis as any).document = originalDocument;
    });

    it("should call handler when beforeunload fires and cleanup removes listener", () => {
      const mockWindow = {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      } as any;
      (globalThis as any).window = mockWindow;
      const handler = jest.fn();
      const cleanup = adapter.onShutdownSignal(handler);

      // Find and invoke the beforeunload handler
      const beforeHandler = mockWindow.addEventListener.mock.calls.find(
        (call: any[]) => call[0] === "beforeunload"
      )?.[1];
      expect(beforeHandler).toBeDefined();
      beforeHandler();
      expect(handler).toHaveBeenCalled();

      cleanup();
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function)
      );
    });
    it("should not add visibilitychange listener when document is not available", () => {
      const mockWindow = {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      };
      (globalThis as any).window = mockWindow;
      delete (globalThis as any).document;

      const handler = jest.fn();
      const cleanup = adapter.onShutdownSignal(handler);

      expect(mockWindow.addEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
      expect(mockWindow.addEventListener).not.toHaveBeenCalledWith("visibilitychange", expect.any(Function));

      cleanup();
      expect(mockWindow.removeEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    });

    it("should call handler when document visibility changes to hidden", () => {
      const mockWindow = {
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      };
      const mockDocument = {
        visibilityState: "hidden"
      };
      
      (globalThis as any).window = mockWindow;
      (globalThis as any).document = mockDocument;

      const handler = jest.fn();
      adapter.onShutdownSignal(handler);

      // Get the visibility change handler
      const visibilityHandler = mockWindow.addEventListener.mock.calls.find(
        call => call[0] === "visibilitychange"
      )?.[1];

      expect(visibilityHandler).toBeDefined();
      
      // Call the visibility handler
      visibilityHandler();
      
      expect(handler).toHaveBeenCalled();
    });

    it("should use globalThis when window is undefined", () => {
      delete (globalThis as any).window;
      const globalAddEventListener = jest.fn();
      const globalRemoveEventListener = jest.fn();
      const originalAdd = (globalThis as any).addEventListener;
      const originalRemove = (globalThis as any).removeEventListener;
      
      (globalThis as any).addEventListener = globalAddEventListener;
      (globalThis as any).removeEventListener = globalRemoveEventListener;

      const handler = jest.fn();
      const cleanup = adapter.onShutdownSignal(handler);

      expect(globalAddEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
      
      cleanup();
      expect(globalRemoveEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
      
      // Restore
      (globalThis as any).addEventListener = originalAdd;
      (globalThis as any).removeEventListener = originalRemove;
    });

  });

  describe("onUncaughtException - handler execution", () => {
    const originalWindow = (globalThis as any).window;

    afterEach(() => {
      (globalThis as any).window = originalWindow;
    });

    it("invokes handler with e.error when error event fires", () => {
      const listeners: Record<string, Function> = {};
      (globalThis as any).window = {
        addEventListener: (evt: string, fn: Function) => (listeners[evt] = fn),
        removeEventListener: jest.fn(),
      } as any;

      const errorObj = new Error("boom");
      const spy = jest.fn();
      const disposer = adapter.onUncaughtException(spy);
      // Fire the error event with { error }
      listeners["error"]?.({ error: errorObj });
      expect(spy).toHaveBeenCalledWith(errorObj);
      disposer();
    });
  });

  describe("onUnhandledRejection - additional coverage", () => {
    const originalWindow = (globalThis as any).window;

    afterEach(() => {
      (globalThis as any).window = originalWindow;
    });

    it("should use globalThis when window is undefined", () => {
      delete (globalThis as any).window;
      const globalAddEventListener = jest.fn();
      const globalRemoveEventListener = jest.fn();
      const originalAdd = (globalThis as any).addEventListener;
      const originalRemove = (globalThis as any).removeEventListener;
      
      (globalThis as any).addEventListener = globalAddEventListener;
      (globalThis as any).removeEventListener = globalRemoveEventListener;

      const handler = jest.fn();
      const cleanup = adapter.onUnhandledRejection(handler);

      expect(globalAddEventListener).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));
      
      cleanup();
      expect(globalRemoveEventListener).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));
      
      // Restore
      (globalThis as any).addEventListener = originalAdd;
      (globalThis as any).removeEventListener = originalRemove;
    });
  });

  describe("createAsyncLocalStorage", () => {
    it("should throw PlatformUnsupportedFunction on getStore", () => {
      const als = adapter.createAsyncLocalStorage();
      expect(() => als.getStore()).toThrow(PlatformUnsupportedFunction);
    });

    it("should throw PlatformUnsupportedFunction on run", () => {
      const als = adapter.createAsyncLocalStorage();
      expect(() => als.run(undefined as any, () => {})).toThrow(PlatformUnsupportedFunction);
    });
  });

  describe("exit", () => {
    it("should throw PlatformUnsupportedFunction", () => {
      expect(() => adapter.exit()).toThrow(PlatformUnsupportedFunction);
    });
  });

  describe("hasAsyncLocalStorage", () => {
    it("should always return false", () => {
      expect(adapter.hasAsyncLocalStorage()).toBe(false);
    });
  });

  describe("init", () => {
    it("should complete without error", async () => {
      await expect(adapter.init()).resolves.toBeUndefined();
    });
  });
});