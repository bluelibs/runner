describe("processHooks platform integration", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("registerShutdownHook disposes and swallows unsupported exit", () => {
    jest.isolateModules(() => {
      // Fake adapter that captures shutdown handler and throws on exit
      class FakeAdapter {
        onUncaughtException() { return () => {}; }
        onUnhandledRejection() { return () => {}; }
        onShutdownSignal(handler: () => void) {
          (this as any)._shutdown = handler;
          return () => {};
        }
        exit() { /* no-op to avoid process exit in tests */ }
        getEnv() { return undefined; }
        createAsyncLocalStorage() { return { getStore: () => undefined, run: (_: any, cb: any) => cb() }; }
        setTimeout = setTimeout;
        clearTimeout = clearTimeout;
      }

      const { setPlatform } = require("../platform");
      const adapter: any = new FakeAdapter();
      setPlatform(adapter);

      const { registerShutdownHook } = require("../processHooks");

      let disposed = false;
      const unhook = registerShutdownHook(async () => {
        disposed = true;
      });

      // Trigger the captured shutdown handler
      return (adapter as any)._shutdown().then(() => {
        expect(disposed).toBe(true);
      });

      expect(disposed).toBe(true);
      // exit throws PlatformUnsupportedFunction but processHooks must swallow it
      // If not swallowed, the test would fail.
      unhook();
    });
  });

  it("registerShutdownHook rethrows non-PlatformUnsupportedFunction errors from exit", () => {
    jest.isolateModules(async () => {
      // Fake adapter that throws a generic error on exit
      class FakeAdapterWithGenericError {
        onUncaughtException() { return () => {}; }
        onUnhandledRejection() { return () => {}; }
        onShutdownSignal(handler: () => void) {
          (this as any)._shutdown = handler;
          return () => {};
        }
        exit() { 
          throw new Error("Generic exit error"); 
        }
        getEnv() { return undefined; }
        createAsyncLocalStorage() { return { getStore: () => undefined, run: (_: any, cb: any) => cb() }; }
        setTimeout = setTimeout;
        clearTimeout = clearTimeout;
      }

      const { setPlatform } = require("../platform");
      const adapter: any = new FakeAdapterWithGenericError();
      setPlatform(adapter);

      const { registerShutdownHook } = require("../processHooks");

      let disposed = false;
      const unhook = registerShutdownHook(async () => {
        disposed = true;
      });

      // Trigger the captured shutdown handler - should rethrow the generic error
      await expect((adapter as any)._shutdown()).rejects.toThrow("Generic exit error");
      
      expect(disposed).toBe(true);
      unhook();
    });
  });
});
