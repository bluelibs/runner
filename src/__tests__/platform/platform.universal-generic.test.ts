import { GenericUniversalPlatformAdapter } from "../../platform/adapters/universal-generic";

interface TestGlobal {
  addEventListener?: typeof globalThis.addEventListener;
  removeEventListener?: typeof globalThis.removeEventListener;
  document?: { visibilityState: string };
  __ENV__?: any;
  process?: any;
  env?: any;
  Deno?: { env?: { get?: (key: string) => string | undefined } } | unknown;
  Bun?: { env?: Record<string, string | undefined> } | unknown;
  AsyncLocalStorage?: new <T>() => {
    getStore(): T | undefined;
    run<R>(store: T, callback: () => R): R;
  };
}
const testGlobal = globalThis as unknown as TestGlobal;

describe("GenericUniversalPlatformAdapter", () => {
  let adapter: GenericUniversalPlatformAdapter;

  beforeEach(() => {
    adapter = new GenericUniversalPlatformAdapter();
  });

  describe("init", () => {
    it("should complete without error", async () => {
      await expect(adapter.init()).resolves.toBeUndefined();
    });

    it("short-circuits when async storage was already probed", async () => {
      testGlobal.Deno = {};
      (adapter as unknown as { alsProbed: boolean }).alsProbed = true;

      await expect(adapter.init()).resolves.toBeUndefined();

      delete testGlobal.Deno;
    });

    it("captures global AsyncLocalStorage during init for Deno", async () => {
      const originalDeno = testGlobal.Deno;
      const originalAsyncLocalStorage = testGlobal.AsyncLocalStorage;

      testGlobal.Deno = {};
      testGlobal.AsyncLocalStorage = class MockALS<T> {
        getStore(): T | undefined {
          return undefined;
        }
        run<R>(_store: T, callback: () => R): R {
          return callback();
        }
      };

      const denoAdapter = new GenericUniversalPlatformAdapter();
      await expect(denoAdapter.init()).resolves.toBeUndefined();
      expect(denoAdapter.hasAsyncLocalStorage()).toBe(true);

      testGlobal.Deno = originalDeno;
      testGlobal.AsyncLocalStorage = originalAsyncLocalStorage;
    });

    it("captures global AsyncLocalStorage during init outside Deno too", async () => {
      const originalAsyncLocalStorage = testGlobal.AsyncLocalStorage;

      testGlobal.AsyncLocalStorage = class MockALS<T> {
        getStore(): T | undefined {
          return undefined;
        }
        run<R>(_store: T, callback: () => R): R {
          return callback();
        }
      };

      const genericAdapter = new GenericUniversalPlatformAdapter();
      await expect(genericAdapter.init()).resolves.toBeUndefined();
      expect(genericAdapter.hasAsyncLocalStorage()).toBe(true);

      testGlobal.AsyncLocalStorage = originalAsyncLocalStorage;
    });

    it("falls back to async import during init when builtin lookup returns undefined", async () => {
      const originalDeno = testGlobal.Deno;
      const originalAsyncLocalStorage = testGlobal.AsyncLocalStorage;
      const builtinSpy = jest
        .spyOn(process, "getBuiltinModule")
        .mockReturnValue(undefined);

      testGlobal.Deno = {};
      (testGlobal as { AsyncLocalStorage?: unknown }).AsyncLocalStorage =
        undefined;

      jest.doMock("node:async_hooks", () => ({
        AsyncLocalStorage: class MockALS<T> {
          getStore(): T | undefined {
            return undefined;
          }
          run<R>(_store: T, callback: () => R): R {
            return callback();
          }
        },
      }));

      const denoAdapter = new GenericUniversalPlatformAdapter();
      await expect(denoAdapter.init()).resolves.toBeUndefined();
      expect(denoAdapter.hasAsyncLocalStorage()).toBe(true);

      jest.dontMock("node:async_hooks");
      builtinSpy.mockRestore();
      testGlobal.Deno = originalDeno;
      testGlobal.AsyncLocalStorage = originalAsyncLocalStorage;
    });

    it("falls back to async import during init when process is unavailable", async () => {
      const originalDeno = testGlobal.Deno;
      const originalAsyncLocalStorage = testGlobal.AsyncLocalStorage;
      const originalProcess = testGlobal.process;

      testGlobal.Deno = {};
      (testGlobal as { AsyncLocalStorage?: unknown }).AsyncLocalStorage =
        undefined;
      delete testGlobal.process;

      jest.doMock("node:async_hooks", () => ({
        AsyncLocalStorage: class MockALS<T> {
          getStore(): T | undefined {
            return undefined;
          }
          run<R>(_store: T, callback: () => R): R {
            return callback();
          }
        },
      }));

      const denoAdapter = new GenericUniversalPlatformAdapter();
      await expect(denoAdapter.init()).resolves.toBeUndefined();
      expect(denoAdapter.hasAsyncLocalStorage()).toBe(true);

      jest.dontMock("node:async_hooks");
      testGlobal.Deno = originalDeno;
      testGlobal.AsyncLocalStorage = originalAsyncLocalStorage;
      testGlobal.process = originalProcess;
    });
  });

  describe("onUncaughtException", () => {
    const originalAddEventListener = testGlobal.addEventListener;
    const originalRemoveEventListener = testGlobal.removeEventListener;

    afterEach(() => {
      testGlobal.addEventListener = originalAddEventListener;
      testGlobal.removeEventListener = originalRemoveEventListener;
    });

    it("should return no-op when addEventListener is not available", () => {
      delete testGlobal.addEventListener;

      const handler = jest.fn();
      const cleanup = adapter.onUncaughtException(handler);

      expect(typeof cleanup).toBe("function");
      expect(() => cleanup()).not.toThrow();
    });

    it("should add and remove event listener when addEventListener is available", () => {
      const addSpy = jest.fn();
      const removeSpy = jest.fn();

      testGlobal.addEventListener = addSpy;
      testGlobal.removeEventListener = removeSpy;

      const handler = jest.fn();
      const cleanup = adapter.onUncaughtException(handler);

      expect(addSpy).toHaveBeenCalledWith("error", expect.any(Function));

      cleanup();
      expect(removeSpy).toHaveBeenCalledWith("error", expect.any(Function));
    });
  });

  describe("onUnhandledRejection", () => {
    const originalAddEventListener = testGlobal.addEventListener;
    const originalRemoveEventListener = testGlobal.removeEventListener;

    afterEach(() => {
      testGlobal.addEventListener = originalAddEventListener;
      testGlobal.removeEventListener = originalRemoveEventListener;
    });

    it("should return no-op when addEventListener is not available", () => {
      delete testGlobal.addEventListener;

      const handler = jest.fn();
      const cleanup = adapter.onUnhandledRejection(handler);

      expect(typeof cleanup).toBe("function");
      expect(() => cleanup()).not.toThrow();
    });

    it("should add and remove event listener when addEventListener is available", () => {
      const addSpy = jest.fn();
      const removeSpy = jest.fn();

      testGlobal.addEventListener = addSpy;
      testGlobal.removeEventListener = removeSpy;

      const handler = jest.fn();
      const cleanup = adapter.onUnhandledRejection(handler);

      expect(addSpy).toHaveBeenCalledWith(
        "unhandledrejection",
        expect.any(Function),
      );

      cleanup();
      expect(removeSpy).toHaveBeenCalledWith(
        "unhandledrejection",
        expect.any(Function),
      );
    });
  });

  describe("onShutdownSignal", () => {
    const originalAddEventListener = testGlobal.addEventListener;
    const originalRemoveEventListener = testGlobal.removeEventListener;
    const originalDocument = testGlobal.document;

    afterEach(() => {
      testGlobal.addEventListener = originalAddEventListener;
      testGlobal.removeEventListener = originalRemoveEventListener;
      testGlobal.document = originalDocument;
    });

    it("should return no-op when addEventListener is not available", () => {
      delete testGlobal.addEventListener;

      const handler = jest.fn();
      const cleanup = adapter.onShutdownSignal(handler);

      expect(typeof cleanup).toBe("function");
      expect(() => cleanup()).not.toThrow();
    });

    it("should add beforeunload listener without visibilitychange when document is not available", () => {
      const addSpy = jest.fn();
      const removeSpy = jest.fn();

      testGlobal.addEventListener = addSpy;
      testGlobal.removeEventListener = removeSpy;
      delete testGlobal.document;

      const handler = jest.fn();
      const cleanup = adapter.onShutdownSignal(handler);

      expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
      expect(addSpy).not.toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );

      cleanup();
      expect(removeSpy).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function),
      );
    });

    it("should add both beforeunload and visibilitychange listeners when document is available", () => {
      const addSpy = jest.fn();
      const removeSpy = jest.fn();

      testGlobal.addEventListener = addSpy;
      testGlobal.removeEventListener = removeSpy;
      testGlobal.document = { visibilityState: "visible" };

      const handler = jest.fn();
      const cleanup = adapter.onShutdownSignal(handler);

      expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
      expect(addSpy).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );

      cleanup();
      expect(removeSpy).toHaveBeenCalledWith(
        "beforeunload",
        expect.any(Function),
      );
      expect(removeSpy).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );
    });

    it("does not invoke handler when visibility state is not hidden", () => {
      const addSpy = jest.fn();
      testGlobal.addEventListener = addSpy;
      testGlobal.removeEventListener = jest.fn();
      testGlobal.document = { visibilityState: "visible" };

      const handler = jest.fn();
      adapter.onShutdownSignal(handler);

      const visibilityListener = addSpy.mock.calls.find(
        (call) => call[0] === "visibilitychange",
      )?.[1] as (() => void) | undefined;
      expect(visibilityListener).toBeDefined();
      visibilityListener?.();
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("exit", () => {
    it("should throw PlatformUnsupportedFunction", () => {
      expect(() => adapter.exit()).toThrow();
    });
  });

  describe("getEnv", () => {
    const originalEnv = testGlobal.__ENV__;
    const originalProcess = testGlobal.process;
    const originalGlobalEnv = testGlobal.env;
    const originalDeno = testGlobal.Deno;
    const originalBun = testGlobal.Bun;

    afterEach(() => {
      testGlobal.__ENV__ = originalEnv;
      testGlobal.process = originalProcess;
      testGlobal.env = originalGlobalEnv;
      testGlobal.Deno = originalDeno;
      testGlobal.Bun = originalBun;
    });

    it("should return value from __ENV__ when available", () => {
      testGlobal.__ENV__ = { TEST_KEY: "from-env" };
      expect(adapter.getEnv("TEST_KEY")).toBe("from-env");
    });

    it("should return value from process.env when available and __ENV__ is not object", () => {
      testGlobal.__ENV__ = null;
      testGlobal.process = { env: { TEST_KEY: "from-process" } };
      expect(adapter.getEnv("TEST_KEY")).toBe("from-process");
    });

    it("should return value from globalThis.env when available", () => {
      delete testGlobal.__ENV__;
      delete testGlobal.process;
      testGlobal.env = { TEST_KEY: "from-global-env" };
      expect(adapter.getEnv("TEST_KEY")).toBe("from-global-env");
    });

    it("should return value from Deno.env.get when available", () => {
      delete testGlobal.__ENV__;
      delete testGlobal.process;
      delete testGlobal.env;
      testGlobal.Deno = {
        env: {
          get: (key: string) =>
            key === "TEST_KEY" ? "from-deno-env" : undefined,
        },
      };

      expect(adapter.getEnv("TEST_KEY")).toBe("from-deno-env");
    });

    it("should return value from Bun.env when available", () => {
      delete testGlobal.__ENV__;
      delete testGlobal.process;
      delete testGlobal.env;
      delete testGlobal.Deno;
      testGlobal.Bun = { env: { TEST_KEY: "from-bun-env" } };

      expect(adapter.getEnv("TEST_KEY")).toBe("from-bun-env");
    });

    it("should return undefined when key is not found", () => {
      delete testGlobal.__ENV__;
      delete testGlobal.process;
      delete testGlobal.env;
      expect(adapter.getEnv("NONEXISTENT_KEY")).toBeUndefined();
    });
  });

  describe("hasAsyncLocalStorage", () => {
    it("should return false when no async local storage implementation exists", () => {
      const originalAsyncLocalStorage = testGlobal.AsyncLocalStorage;
      const builtinSpy = jest
        .spyOn(process, "getBuiltinModule")
        .mockReturnValue(undefined);

      (testGlobal as { AsyncLocalStorage?: unknown }).AsyncLocalStorage =
        undefined;

      expect(new GenericUniversalPlatformAdapter().hasAsyncLocalStorage()).toBe(
        false,
      );

      builtinSpy.mockRestore();
      testGlobal.AsyncLocalStorage = originalAsyncLocalStorage;
    });

    it("should return true outside Deno when AsyncLocalStorage is globally available", () => {
      const originalAsyncLocalStorage = testGlobal.AsyncLocalStorage;

      testGlobal.AsyncLocalStorage = class MockALS<T> {
        getStore(): T | undefined {
          return undefined;
        }
        run<R>(_store: T, callback: () => R): R {
          return callback();
        }
      };

      const genericAdapter = new GenericUniversalPlatformAdapter();
      expect(genericAdapter.hasAsyncLocalStorage()).toBe(true);

      testGlobal.AsyncLocalStorage = originalAsyncLocalStorage;
    });

    it("should return true in Deno when AsyncLocalStorage is available", () => {
      const originalDeno = testGlobal.Deno;
      const originalAsyncLocalStorage = testGlobal.AsyncLocalStorage;

      testGlobal.Deno = {};
      testGlobal.AsyncLocalStorage = class MockALS<T> {
        getStore(): T | undefined {
          return undefined;
        }
        run<R>(_store: T, callback: () => R): R {
          return callback();
        }
      };

      const denoAdapter = new GenericUniversalPlatformAdapter();
      expect(denoAdapter.hasAsyncLocalStorage()).toBe(true);

      testGlobal.Deno = originalDeno;
      testGlobal.AsyncLocalStorage = originalAsyncLocalStorage;
    });

    it("should probe node:async_hooks fallback once for Deno when global ALS is missing", () => {
      const originalDeno = testGlobal.Deno;
      const originalAsyncLocalStorage = testGlobal.AsyncLocalStorage;

      testGlobal.Deno = {};
      (testGlobal as { AsyncLocalStorage?: unknown }).AsyncLocalStorage =
        undefined;

      const denoAdapter = new GenericUniversalPlatformAdapter();
      expect(denoAdapter.hasAsyncLocalStorage()).toBe(true);
      // second call covers the already-probed fast path
      expect(denoAdapter.hasAsyncLocalStorage()).toBe(true);

      testGlobal.Deno = originalDeno;
      testGlobal.AsyncLocalStorage = originalAsyncLocalStorage;
    });

    it("uses mocked node:async_hooks fallback when global ALS is absent in Deno", () => {
      const originalDeno = testGlobal.Deno;
      const originalAsyncLocalStorage = testGlobal.AsyncLocalStorage;

      testGlobal.Deno = {};
      (testGlobal as { AsyncLocalStorage?: unknown }).AsyncLocalStorage =
        undefined;

      jest.doMock("node:async_hooks", () => ({
        AsyncLocalStorage: class MockALS<T> {
          getStore(): T | undefined {
            return undefined;
          }
          run<R>(_store: T, callback: () => R): R {
            return callback();
          }
        },
      }));

      const denoAdapter = new GenericUniversalPlatformAdapter();
      expect(denoAdapter.hasAsyncLocalStorage()).toBe(true);

      jest.dontMock("node:async_hooks");
      testGlobal.Deno = originalDeno;
      testGlobal.AsyncLocalStorage = originalAsyncLocalStorage;
    });

    it("returns false when builtin async_hooks lookup throws in Deno", () => {
      const originalDeno = testGlobal.Deno;
      const originalAsyncLocalStorage = testGlobal.AsyncLocalStorage;
      const builtinSpy = jest
        .spyOn(process, "getBuiltinModule")
        .mockImplementation(() => {
          throw new Error("boom");
        });

      testGlobal.Deno = {};
      (testGlobal as { AsyncLocalStorage?: unknown }).AsyncLocalStorage =
        undefined;

      const denoAdapter = new GenericUniversalPlatformAdapter();
      expect(denoAdapter.hasAsyncLocalStorage()).toBe(false);

      builtinSpy.mockRestore();
      testGlobal.Deno = originalDeno;
      testGlobal.AsyncLocalStorage = originalAsyncLocalStorage;
    });

    it("returns false when builtin async_hooks lookup returns undefined in Deno", () => {
      const originalDeno = testGlobal.Deno;
      const originalAsyncLocalStorage = testGlobal.AsyncLocalStorage;
      const builtinSpy = jest
        .spyOn(process, "getBuiltinModule")
        .mockReturnValue(undefined);

      testGlobal.Deno = {};
      (testGlobal as { AsyncLocalStorage?: unknown }).AsyncLocalStorage =
        undefined;

      const denoAdapter = new GenericUniversalPlatformAdapter();
      expect(denoAdapter.hasAsyncLocalStorage()).toBe(false);

      builtinSpy.mockRestore();
      testGlobal.Deno = originalDeno;
      testGlobal.AsyncLocalStorage = originalAsyncLocalStorage;
    });
  });

  describe("createAsyncLocalStorage", () => {
    it("should return object with throwing methods", () => {
      const originalAsyncLocalStorage = testGlobal.AsyncLocalStorage;
      const builtinSpy = jest
        .spyOn(process, "getBuiltinModule")
        .mockReturnValue(undefined);

      (testGlobal as { AsyncLocalStorage?: unknown }).AsyncLocalStorage =
        undefined;

      const als =
        new GenericUniversalPlatformAdapter().createAsyncLocalStorage();

      expect(typeof als.getStore).toBe("function");
      expect(typeof als.run).toBe("function");

      expect(() => als.getStore()).toThrow();
      expect(() => als.run(undefined as unknown as any, () => {})).toThrow();

      builtinSpy.mockRestore();
      testGlobal.AsyncLocalStorage = originalAsyncLocalStorage;
    });

    it("should create a working ALS instance in Deno when available", () => {
      const originalDeno = testGlobal.Deno;
      const originalAsyncLocalStorage = testGlobal.AsyncLocalStorage;

      testGlobal.Deno = {};
      testGlobal.AsyncLocalStorage = class MockALS<T> {
        private store: T | undefined;
        getStore(): T | undefined {
          return this.store;
        }
        run<R>(store: T, callback: () => R): R {
          const previous = this.store;
          this.store = store;
          try {
            return callback();
          } finally {
            this.store = previous;
          }
        }
      };

      const denoAdapter = new GenericUniversalPlatformAdapter();
      const als = denoAdapter.createAsyncLocalStorage<{ id: string }>();
      const result = als.run({ id: "deno" }, () => als.getStore());
      expect(result).toEqual({ id: "deno" });

      testGlobal.Deno = originalDeno;
      testGlobal.AsyncLocalStorage = originalAsyncLocalStorage;
    });

    it("should create a working ALS instance outside Deno when globally available", () => {
      const originalAsyncLocalStorage = testGlobal.AsyncLocalStorage;

      testGlobal.AsyncLocalStorage = class MockALS<T> {
        private store: T | undefined;
        getStore(): T | undefined {
          return this.store;
        }
        run<R>(store: T, callback: () => R): R {
          const previous = this.store;
          this.store = store;
          try {
            return callback();
          } finally {
            this.store = previous;
          }
        }
      };

      const genericAdapter = new GenericUniversalPlatformAdapter();
      const als = genericAdapter.createAsyncLocalStorage<{ id: string }>();
      const result = als.run({ id: "bun-ish" }, () => als.getStore());
      expect(result).toEqual({ id: "bun-ish" });

      testGlobal.AsyncLocalStorage = originalAsyncLocalStorage;
    });
  });

  describe("timeout methods", () => {
    it("should use globalThis.setTimeout", () => {
      expect(adapter.setTimeout).toBe(globalThis.setTimeout);
    });

    it("should use globalThis.clearTimeout", () => {
      expect(adapter.clearTimeout).toBe(globalThis.clearTimeout);
    });
  });
});
