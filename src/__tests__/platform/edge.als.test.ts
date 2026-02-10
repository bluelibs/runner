import { EdgePlatformAdapter } from "../../platform/adapters/edge";
import { platformUnsupportedFunctionError } from "../../errors";

describe("EdgePlatformAdapter ALS support", () => {
  it("should detect ALS when available via globalThis", async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const original = g.AsyncLocalStorage;
    g.AsyncLocalStorage = class MockALS<T> {
      private store: T | undefined;
      getStore() {
        return this.store;
      }
      run<R>(store: T, cb: () => R): R {
        const prev = this.store;
        this.store = store;
        try {
          return cb();
        } finally {
          this.store = prev;
        }
      }
    };

    try {
      const adapter = new EdgePlatformAdapter();
      await adapter.init();

      expect(adapter.hasAsyncLocalStorage()).toBe(true);
      const als = adapter.createAsyncLocalStorage<{ value: number }>();
      const result = als.run({ value: 42 }, () => als.getStore());
      expect(result).toEqual({ value: 42 });
    } finally {
      g.AsyncLocalStorage = original;
    }
  });

  it("should fall back to unsupported ALS wrapper when ALS is unavailable", () => {
    const adapter = new EdgePlatformAdapter();
    // Force the noop path by marking as probed with no class found
    (adapter as unknown as { alsProbed: boolean }).alsProbed = true;
    (adapter as unknown as { alsClass: null }).alsClass = null;

    expect(adapter.hasAsyncLocalStorage()).toBe(false);
    const als = adapter.createAsyncLocalStorage<string>();
    expect(() => als.getStore()).toThrow();
    try {
      als.getStore();
    } catch (error) {
      expect(platformUnsupportedFunctionError.is(error)).toBe(true);
    }
  });

  it("should detect ALS from node:async_hooks during init when global is unavailable", async () => {
    const g = globalThis as unknown as Record<string, unknown>;
    const original = g.AsyncLocalStorage;
    delete g.AsyncLocalStorage;

    try {
      const adapter = new EdgePlatformAdapter();
      await adapter.init();
      expect(adapter.hasAsyncLocalStorage()).toBe(true);
      const als = adapter.createAsyncLocalStorage<{ ok: boolean }>();
      const result = als.run({ ok: true }, () => als.getStore());
      expect(result).toEqual({ ok: true });
    } finally {
      g.AsyncLocalStorage = original;
    }
  });

  it("should return noop disposer for shutdown signal", () => {
    const adapter = new EdgePlatformAdapter();
    const dispose = adapter.onShutdownSignal(() => {});
    expect(typeof dispose).toBe("function");
    dispose(); // should not throw
  });
});
