import { GenericUniversalPlatformAdapter } from "../../platform/adapters/universal-generic";

interface TestGlobal {
  addEventListener?: typeof globalThis.addEventListener;
  removeEventListener?: typeof globalThis.removeEventListener;
  document?: { visibilityState: string };
  __ENV__?: any;
  process?: any;
  env?: any;
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

    afterEach(() => {
      testGlobal.__ENV__ = originalEnv;
      testGlobal.process = originalProcess;
      testGlobal.env = originalGlobalEnv;
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

    it("should return undefined when key is not found", () => {
      delete testGlobal.__ENV__;
      delete testGlobal.process;
      delete testGlobal.env;
      expect(adapter.getEnv("NONEXISTENT_KEY")).toBeUndefined();
    });
  });

  describe("hasAsyncLocalStorage", () => {
    it("should always return false", () => {
      expect(adapter.hasAsyncLocalStorage()).toBe(false);
    });
  });

  describe("createAsyncLocalStorage", () => {
    it("should return object with throwing methods", () => {
      const als = adapter.createAsyncLocalStorage();

      expect(typeof als.getStore).toBe("function");
      expect(typeof als.run).toBe("function");

      expect(() => als.getStore()).toThrow();
      expect(() => als.run(undefined as unknown as any, () => {})).toThrow();
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
