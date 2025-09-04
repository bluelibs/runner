import { BrowserPlatformAdapter } from "../platform";

describe("BrowserPlatformAdapter", () => {
  it("should register and cleanup error listeners", () => {
    const adapter = new BrowserPlatformAdapter();

    const originalAdd = (globalThis as any).addEventListener;
    const originalRemove = (globalThis as any).removeEventListener;
    const addSpy = jest.fn();
    const removeSpy = jest.fn();
    (globalThis as any).addEventListener = addSpy;
    (globalThis as any).removeEventListener = removeSpy;

    const cleanup = adapter.onUncaughtException(() => {});
    expect(addSpy).toHaveBeenCalledWith("error", expect.any(Function));

    cleanup();
    expect(removeSpy).toHaveBeenCalledWith("error", expect.any(Function));

    (globalThis as any).addEventListener = originalAdd;
    (globalThis as any).removeEventListener = originalRemove;
  });

  it("should use window listeners when available and cleanup correctly", () => {
    const adapter = new BrowserPlatformAdapter();

    const originalWindow: any = (globalThis as any).window;
    const addSpy = jest.fn();
    const removeSpy = jest.fn();
    (globalThis as any).window = {
      addEventListener: addSpy,
      removeEventListener: removeSpy,
    };

    const cleanupErr = adapter.onUncaughtException(() => {});
    expect(addSpy).toHaveBeenCalledWith("error", expect.any(Function));
    cleanupErr();
    expect(removeSpy).toHaveBeenCalledWith("error", expect.any(Function));

    const cleanupRej = adapter.onUnhandledRejection(() => {});
    expect(addSpy).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));
    cleanupRej();
    expect(removeSpy).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));

    // onShutdownSignal should register beforeunload and visibilitychange
    const cleanupShutdown = adapter.onShutdownSignal(() => {});
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    cleanupShutdown();
    expect(removeSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
    expect(removeSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );

    (globalThis as any).window = originalWindow;
  });

  it("should invoke shutdown handler on visibilitychange when hidden", () => {
    const adapter = new BrowserPlatformAdapter();

    const originalWindow: any = (globalThis as any).window;
    const listeners: Record<string, Function> = {};
    (globalThis as any).window = {
      addEventListener: (evt: string, fn: Function) => (listeners[evt] = fn),
      removeEventListener: () => {},
    } as any;

    let called = false;
    // Provide a document with hidden state
    const originalDocument = (globalThis as any).document;
    (globalThis as any).document = { visibilityState: "visible" } as any;

    adapter.onShutdownSignal(() => {
      called = true;
    });

    // Simulate becoming hidden
    (globalThis as any).document.visibilityState = "hidden";
    listeners["visibilitychange"]?.();
    expect(called).toBe(true);

    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
  });

  it("should use globalThis fallback for unhandledrejection and cleanup", () => {
    const adapter = new BrowserPlatformAdapter();

    const originalAdd = (globalThis as any).addEventListener;
    const originalRemove = (globalThis as any).removeEventListener;
    const addSpy = jest.fn();
    const removeSpy = jest.fn();
    (globalThis as any).addEventListener = addSpy;
    (globalThis as any).removeEventListener = removeSpy;
    const originalWindow = (globalThis as any).window;
    delete (globalThis as any).window; // force fallback path

    const cleanup = adapter.onUnhandledRejection(() => {});
    expect(addSpy).toHaveBeenCalledWith(
      "unhandledrejection",
      expect.any(Function),
    );
    cleanup();
    expect(removeSpy).toHaveBeenCalledWith(
      "unhandledrejection",
      expect.any(Function),
    );

    (globalThis as any).addEventListener = originalAdd;
    (globalThis as any).removeEventListener = originalRemove;
    (globalThis as any).window = originalWindow;
  });

  it("should use globalThis fallback for shutdown listeners and cleanup", () => {
    const adapter = new BrowserPlatformAdapter();

    const originalAdd = (globalThis as any).addEventListener;
    const originalRemove = (globalThis as any).removeEventListener;
    const addSpy = jest.fn();
    const removeSpy = jest.fn();
    (globalThis as any).addEventListener = addSpy;
    (globalThis as any).removeEventListener = removeSpy;
    const originalWindow = (globalThis as any).window;
    delete (globalThis as any).window; // force fallback path

    const cleanup = adapter.onShutdownSignal(() => {});
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));

    cleanup();
    expect(removeSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
    expect(removeSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );

    (globalThis as any).addEventListener = originalAdd;
    (globalThis as any).removeEventListener = originalRemove;
    (globalThis as any).window = originalWindow;
  });

  it("should throw on exit", () => {
    const adapter = new BrowserPlatformAdapter();
    expect(() => adapter.exit(0)).toThrow();
  });

  it("should support env fallbacks", () => {
    const adapter = new BrowserPlatformAdapter();
    (globalThis as any).__ENV__ = { A: "1" };
    expect(adapter.getEnv("A")).toBe("1");
    delete (globalThis as any).__ENV__;

    (globalThis as any).process = { env: { A: "2" } };
    expect(adapter.getEnv("A")).toBe("2");
    delete (globalThis as any).process;

    (globalThis as any).env = { A: "3" };
    expect(adapter.getEnv("A")).toBe("3");
    delete (globalThis as any).env;
  });

  it("should provide a working ALS polyfill (scoped)", () => {
    const adapter = new BrowserPlatformAdapter();
    const als = adapter.createAsyncLocalStorage<string>();

    let captured: string | undefined;
    als.run("x", () => {
      captured = als.getStore();
    });
    expect(captured).toBe("x");
    expect(als.getStore()).toBeUndefined();
  });

  it("ALS polyfill restores context on throw and rethrows", () => {
    const adapter = new BrowserPlatformAdapter();
    const als = adapter.createAsyncLocalStorage<number>();
    expect(() =>
      als.run(1, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    // Outside run context -> undefined
    expect(als.getStore()).toBeUndefined();
  });

  it("ALS polyfill restores context after async promise settles (finally path)", async () => {
    const adapter = new BrowserPlatformAdapter();
    const als = adapter.createAsyncLocalStorage<string>();

    let during: string | undefined;
    await als.run("async", async () => {
      await Promise.resolve();
      during = als.getStore();
    });

    expect(during).toBe("async");
    expect(als.getStore()).toBeUndefined();
  });

  it("should invoke shutdown handler on beforeunload", () => {
    const adapter = new BrowserPlatformAdapter();

    const originalWindow: any = (globalThis as any).window;
    const listeners: Record<string, Function> = {};
    (globalThis as any).window = {
      addEventListener: (evt: string, fn: Function) => (listeners[evt] = fn),
      removeEventListener: () => {},
    } as any;

    let called = 0;
    adapter.onShutdownSignal(() => {
      called++;
    });

    listeners["beforeunload"]?.();
    expect(called).toBe(1);

    (globalThis as any).window = originalWindow;
  });

  it("does not invoke shutdown handler when document is undefined on visibilitychange", () => {
    const adapter = new BrowserPlatformAdapter();

    const originalWindow: any = (globalThis as any).window;
    const listeners: Record<string, Function> = {};
    (globalThis as any).window = {
      addEventListener: (evt: string, fn: Function) => (listeners[evt] = fn),
      removeEventListener: () => {},
    } as any;

    const originalDocument = (globalThis as any).document;
    delete (globalThis as any).document;

    let called = false;
    adapter.onShutdownSignal(() => {
      called = true;
    });

    listeners["visibilitychange"]?.();
    expect(called).toBe(false);

    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
  });

  it("should trigger error handler when error event fires", () => {
    const adapter = new BrowserPlatformAdapter();

    const originalWindow: any = (globalThis as any).window;
    let capturedListener: any;
    (globalThis as any).window = {
      addEventListener: (evt: string, fn: Function) => {
        if (evt === "error") capturedListener = fn;
      },
      removeEventListener: () => {},
    } as any;

    let handlerCalled = false;
    let capturedError: any;
    adapter.onUncaughtException((error) => {
      handlerCalled = true;
      capturedError = error;
    });

    const testError = new Error("test error");
    const errorEvent = { error: testError };
    capturedListener(errorEvent);

    expect(handlerCalled).toBe(true);
    expect(capturedError).toBe(testError);

    (globalThis as any).window = originalWindow;
  });

  it("should trigger rejection handler when unhandledrejection event fires", () => {
    const adapter = new BrowserPlatformAdapter();

    const originalWindow: any = (globalThis as any).window;
    let capturedListener: any;
    (globalThis as any).window = {
      addEventListener: (evt: string, fn: Function) => {
        if (evt === "unhandledrejection") capturedListener = fn;
      },
      removeEventListener: () => {},
    } as any;

    let handlerCalled = false;
    let capturedReason: any;
    adapter.onUnhandledRejection((reason) => {
      handlerCalled = true;
      capturedReason = reason;
    });

    const testReason = "test rejection reason";
    const rejectionEvent = { reason: testReason };
    capturedListener(rejectionEvent);

    expect(handlerCalled).toBe(true);
    expect(capturedReason).toBe(testReason);

    (globalThis as any).window = originalWindow;
  });
});
