import { GenericUniversalPlatformAdapter } from "../../platform/adapters/universal-generic";
import { BrowserPlatformAdapter } from "../../platform/adapters/browser";
import { NodePlatformAdapter } from "../../platform/adapters/node";
import { EdgePlatformAdapter } from "../../platform/adapters/edge";
import {
  UniversalPlatformAdapter,
  detectEnvironment,
} from "../../platform/adapters/universal";

interface MutableGlobal {
  window?: unknown;
  document?: unknown;
  process?: { versions?: { node?: string; bun?: string }; on?: any; off?: any };
  Deno?: unknown;
  Bun?: unknown;
  WorkerGlobalScope?: unknown;
  self?: unknown;
  addEventListener?: unknown;
  removeEventListener?: unknown;
}

const mutableGlobal = globalThis as unknown as MutableGlobal;

describe("UniversalPlatformAdapter", () => {
  let adapter: UniversalPlatformAdapter;

  beforeEach(() => {
    adapter = new UniversalPlatformAdapter();
  });

  describe("detectEnvironment", () => {
    const originalWindow = mutableGlobal.window;
    const originalDocument = mutableGlobal.document;
    const originalProcess = mutableGlobal.process;
    const originalDeno = mutableGlobal.Deno;
    const originalBun = mutableGlobal.Bun;
    const originalWorkerGlobalScope = mutableGlobal.WorkerGlobalScope;
    const originalSelf = mutableGlobal.self;

    afterEach(() => {
      // Restore original values
      if (originalWindow === undefined) delete mutableGlobal.window;
      else mutableGlobal.window = originalWindow;

      if (originalDocument === undefined) delete mutableGlobal.document;
      else mutableGlobal.document = originalDocument;

      if (originalProcess === undefined) delete mutableGlobal.process;
      else mutableGlobal.process = originalProcess;

      if (originalDeno === undefined) delete mutableGlobal.Deno;
      else mutableGlobal.Deno = originalDeno;

      if (originalBun === undefined) delete mutableGlobal.Bun;
      else mutableGlobal.Bun = originalBun;

      if (originalWorkerGlobalScope === undefined)
        delete mutableGlobal.WorkerGlobalScope;
      else mutableGlobal.WorkerGlobalScope = originalWorkerGlobalScope;

      if (originalSelf === undefined) delete mutableGlobal.self;
      else mutableGlobal.self = originalSelf;

      // Clear any jest mocks
      jest.clearAllMocks();
      jest.restoreAllMocks();
    });

    it("should detect browser environment", () => {
      mutableGlobal.window = {};
      mutableGlobal.document = {};

      expect(detectEnvironment()).toBe("browser");
    });

    it("should detect node environment", () => {
      delete mutableGlobal.window;
      delete mutableGlobal.document;
      mutableGlobal.process = {
        versions: { node: "18.0.0" },
      };

      expect(detectEnvironment()).toBe("node");
    });

    it("should detect Deno universal environment", () => {
      delete mutableGlobal.window;
      delete mutableGlobal.document;
      delete mutableGlobal.process;
      mutableGlobal.Deno = {};

      expect(detectEnvironment()).toBe("universal");
    });

    it("should detect Bun universal environment via globalThis.Bun", () => {
      delete mutableGlobal.window;
      delete mutableGlobal.document;
      delete mutableGlobal.process;
      delete mutableGlobal.Deno;
      mutableGlobal.Bun = {};

      expect(detectEnvironment()).toBe("universal");
    });

    it("should detect Bun universal environment via process.versions.bun", () => {
      delete mutableGlobal.window;
      delete mutableGlobal.document;
      delete mutableGlobal.Deno;
      delete mutableGlobal.Bun;
      mutableGlobal.process = {
        versions: { bun: "1.0.0" },
      };

      expect(detectEnvironment()).toBe("universal");
    });

    it("should detect edge environment", () => {
      delete mutableGlobal.window;
      delete mutableGlobal.document;
      delete mutableGlobal.process;
      delete mutableGlobal.Deno;
      delete mutableGlobal.Bun;

      const mockWorkerGlobalScope = function () {} as unknown;
      const mockSelf = Object.create(
        (mockWorkerGlobalScope as { prototype: object }).prototype,
      );

      mutableGlobal.WorkerGlobalScope = mockWorkerGlobalScope;
      mutableGlobal.self = mockSelf;

      expect(detectEnvironment()).toBe("edge");
    });

    it("should fallback to universal environment", () => {
      delete mutableGlobal.window;
      delete mutableGlobal.document;
      delete mutableGlobal.process;
      delete mutableGlobal.Deno;
      delete mutableGlobal.Bun;
      delete mutableGlobal.WorkerGlobalScope;
      delete mutableGlobal.self;

      expect(detectEnvironment()).toBe("universal");
    });
  });

  describe("init", () => {
    it("should initialize inner adapter based on detected environment", async () => {
      await adapter.init();
      expect((adapter as unknown as { inner: unknown }).inner).toBeDefined();
    });

    it("should not reinitialize if already initialized", async () => {
      await adapter.init();
      const firstInner = (adapter as unknown as { inner: unknown }).inner;

      await adapter.init();
      const secondInner = (adapter as unknown as { inner: unknown }).inner;

      expect(firstInner).toBe(secondInner);
    });

    it("should use BrowserPlatformAdapter when document exists", async () => {
      const originalDocument = mutableGlobal.document;
      mutableGlobal.document = {};

      await adapter.init();
      expect((adapter as unknown as { inner: unknown }).inner).toBeInstanceOf(
        BrowserPlatformAdapter,
      );

      if (originalDocument === undefined) delete mutableGlobal.document;
      else mutableGlobal.document = originalDocument;
    });

    it("should use BrowserPlatformAdapter when addEventListener exists", async () => {
      const originalAddEventListener = mutableGlobal.addEventListener;
      mutableGlobal.addEventListener = () => {};

      await adapter.init();
      expect((adapter as unknown as { inner: unknown }).inner).toBeInstanceOf(
        BrowserPlatformAdapter,
      );

      if (originalAddEventListener === undefined)
        delete mutableGlobal.addEventListener;
      else mutableGlobal.addEventListener = originalAddEventListener;
    });

    it("should use different adapters based on environment in init()", async () => {
      // Test browser case in init - document exists
      const originalDocument = mutableGlobal.document;
      const originalProcess = mutableGlobal.process;

      if (originalProcess === undefined) delete mutableGlobal.process;
      else mutableGlobal.process = originalProcess;
      delete mutableGlobal.process;
      mutableGlobal.document = {};

      const browserAdapter = new UniversalPlatformAdapter();
      await browserAdapter.init();
      expect(
        (browserAdapter as unknown as { inner: unknown }).inner,
      ).toBeInstanceOf(BrowserPlatformAdapter);

      // Test browser case without document but with addEventListener
      delete mutableGlobal.document;
      delete mutableGlobal.process;
      const originalAdd = mutableGlobal.addEventListener;
      mutableGlobal.addEventListener = jest.fn();

      const browserAdapter2 = new UniversalPlatformAdapter();
      await browserAdapter2.init();
      expect(
        (browserAdapter2 as unknown as { inner: unknown }).inner,
      ).toBeInstanceOf(BrowserPlatformAdapter);

      if (originalAdd === undefined) delete mutableGlobal.addEventListener;
      else mutableGlobal.addEventListener = originalAdd;

      // Test node case with mock process
      delete mutableGlobal.addEventListener;
      mutableGlobal.process = {
        versions: { node: "18.0.0" },
        on: jest.fn(),
        off: jest.fn(),
      };

      const nodeAdapter = new UniversalPlatformAdapter();
      await nodeAdapter.init();
      expect(
        (nodeAdapter as unknown as { inner: unknown }).inner,
      ).toBeInstanceOf(NodePlatformAdapter);

      // Test explicit browser environment without document/addEventListener
      delete mutableGlobal.process;
      delete mutableGlobal.document;
      delete mutableGlobal.addEventListener;
      delete mutableGlobal.Deno;
      delete mutableGlobal.Bun;
      delete mutableGlobal.WorkerGlobalScope;
      delete mutableGlobal.self;
      mutableGlobal.window = {};
      mutableGlobal.document = {};

      const explicitBrowserAdapter = new UniversalPlatformAdapter();
      await explicitBrowserAdapter.init();
      expect(
        (explicitBrowserAdapter as unknown as { inner: unknown }).inner,
      ).toBeInstanceOf(BrowserPlatformAdapter);

      // Test edge case
      delete mutableGlobal.window;
      delete mutableGlobal.document;
      delete mutableGlobal.process;
      delete mutableGlobal.addEventListener;
      const mockWorkerGlobalScope = function () {} as unknown;
      const mockSelf = Object.create(
        (mockWorkerGlobalScope as { prototype: object }).prototype,
      );

      mutableGlobal.WorkerGlobalScope = mockWorkerGlobalScope;
      mutableGlobal.self = mockSelf;

      const edgeAdapter = new UniversalPlatformAdapter();
      await edgeAdapter.init();
      expect(
        (edgeAdapter as unknown as { inner: unknown }).inner,
      ).toBeInstanceOf(EdgePlatformAdapter);

      // Test default/universal case
      delete mutableGlobal.WorkerGlobalScope;
      delete mutableGlobal.self;
      delete mutableGlobal.process;
      delete mutableGlobal.document;
      delete mutableGlobal.addEventListener;
      delete mutableGlobal.Deno;
      delete mutableGlobal.Bun;

      const defaultAdapter = new UniversalPlatformAdapter();
      await defaultAdapter.init();
      expect(
        (defaultAdapter as unknown as { inner: unknown }).inner,
      ).toBeInstanceOf(GenericUniversalPlatformAdapter);

      // Restore
      if (originalDocument === undefined) delete mutableGlobal.document;
      else mutableGlobal.document = originalDocument;

      if (originalProcess === undefined) delete mutableGlobal.process;
      else mutableGlobal.process = originalProcess;
    });
  });

  describe("lazy initialization via get()", () => {
    it("should lazily initialize inner adapter when methods are called", () => {
      const handler = jest.fn();
      adapter.onUncaughtException(handler);
      expect((adapter as unknown as { inner: unknown }).inner).toBeDefined();
    });

    it("should use same adapter for subsequent calls", () => {
      const handler = jest.fn();
      adapter.onUncaughtException(handler);
      const firstInner = (adapter as unknown as { inner: unknown }).inner;

      adapter.onUnhandledRejection(handler);
      const secondInner = (adapter as unknown as { inner: unknown }).inner;

      expect(firstInner).toBe(secondInner);
    });

    it("should use different adapters based on environment in get()", () => {
      // Test browser case in get() - document exists
      const originalDocument = mutableGlobal.document;
      const originalProcess = mutableGlobal.process;

      delete mutableGlobal.process;
      mutableGlobal.document = {};

      const browserAdapter = new UniversalPlatformAdapter();
      browserAdapter.onUncaughtException(() => {});
      expect(
        (browserAdapter as unknown as { inner: unknown }).inner,
      ).toBeInstanceOf(BrowserPlatformAdapter);

      // Test browser case without document but with addEventListener
      delete mutableGlobal.document;
      delete mutableGlobal.process;
      const originalAdd = mutableGlobal.addEventListener;
      mutableGlobal.addEventListener = jest.fn();

      const browserAdapter2 = new UniversalPlatformAdapter();
      browserAdapter2.onUncaughtException(() => {});
      expect(
        (browserAdapter2 as unknown as { inner: unknown }).inner,
      ).toBeInstanceOf(BrowserPlatformAdapter);

      if (originalAdd === undefined) delete mutableGlobal.addEventListener;
      else mutableGlobal.addEventListener = originalAdd;

      // Test node case with mock process
      delete mutableGlobal.addEventListener;
      mutableGlobal.process = {
        versions: { node: "18.0.0" },
        on: jest.fn(),
        off: jest.fn(),
      };

      const nodeAdapter = new UniversalPlatformAdapter();
      nodeAdapter.onUncaughtException(() => {});
      expect(
        (nodeAdapter as unknown as { inner: unknown }).inner,
      ).toBeInstanceOf(NodePlatformAdapter);

      // Test explicit browser environment without document/addEventListener
      delete mutableGlobal.process;
      delete mutableGlobal.document;
      delete mutableGlobal.addEventListener;
      delete mutableGlobal.Deno;
      delete mutableGlobal.Bun;
      delete mutableGlobal.WorkerGlobalScope;
      delete mutableGlobal.self;
      mutableGlobal.window = {};
      mutableGlobal.document = {};

      const explicitBrowserAdapter = new UniversalPlatformAdapter();
      explicitBrowserAdapter.onUncaughtException(() => {});
      expect(
        (explicitBrowserAdapter as unknown as { inner: unknown }).inner,
      ).toBeInstanceOf(BrowserPlatformAdapter);

      // Test edge case
      delete mutableGlobal.window;
      delete mutableGlobal.document;
      delete mutableGlobal.process;
      delete mutableGlobal.addEventListener;
      const mockWorkerGlobalScope = function () {} as unknown;
      const mockSelf = Object.create(
        (mockWorkerGlobalScope as { prototype: object }).prototype,
      );

      mutableGlobal.WorkerGlobalScope = mockWorkerGlobalScope;
      mutableGlobal.self = mockSelf;

      const edgeAdapter = new UniversalPlatformAdapter();
      edgeAdapter.onUncaughtException(() => {});
      expect(
        (edgeAdapter as unknown as { inner: unknown }).inner,
      ).toBeInstanceOf(EdgePlatformAdapter);

      // Test default/universal case
      delete mutableGlobal.WorkerGlobalScope;
      delete mutableGlobal.self;
      delete mutableGlobal.process;
      delete mutableGlobal.document;
      delete mutableGlobal.addEventListener;
      delete mutableGlobal.Deno;
      delete mutableGlobal.Bun;

      const defaultAdapter = new UniversalPlatformAdapter();
      defaultAdapter.onUncaughtException(() => {});
      expect(
        (defaultAdapter as unknown as { inner: unknown }).inner,
      ).toBeInstanceOf(GenericUniversalPlatformAdapter);

      // Restore
      if (originalDocument === undefined) delete mutableGlobal.document;
      else mutableGlobal.document = originalDocument;

      if (originalProcess === undefined) delete mutableGlobal.process;
      else mutableGlobal.process = originalProcess;
    });
  });

  describe("delegation methods", () => {
    it("should delegate onUncaughtException to inner adapter", () => {
      const handler = jest.fn();
      const mockInner = { onUncaughtException: jest.fn(() => () => {}) };
      (adapter as unknown as { inner: unknown }).inner = mockInner;

      adapter.onUncaughtException(handler);
      expect(mockInner.onUncaughtException).toHaveBeenCalledWith(handler);
    });

    it("should delegate onUnhandledRejection to inner adapter", () => {
      const handler = jest.fn();
      const mockInner = { onUnhandledRejection: jest.fn(() => () => {}) };
      (adapter as unknown as { inner: unknown }).inner = mockInner;

      adapter.onUnhandledRejection(handler);
      expect(mockInner.onUnhandledRejection).toHaveBeenCalledWith(handler);
    });

    it("should delegate onShutdownSignal to inner adapter", () => {
      const handler = jest.fn();
      const mockInner = { onShutdownSignal: jest.fn(() => () => {}) };
      (adapter as unknown as { inner: unknown }).inner = mockInner;

      adapter.onShutdownSignal(handler);
      expect(mockInner.onShutdownSignal).toHaveBeenCalledWith(handler);
    });

    it("should delegate exit to inner adapter", () => {
      const mockInner = { exit: jest.fn() };
      (adapter as unknown as { inner: unknown }).inner = mockInner;

      adapter.exit(1);
      expect(mockInner.exit).toHaveBeenCalledWith(1);
    });

    it("should delegate getEnv to inner adapter", () => {
      const mockInner = { getEnv: jest.fn(() => "test-value") };
      (adapter as unknown as { inner: unknown }).inner = mockInner;

      const result = adapter.getEnv("TEST_KEY");
      expect(mockInner.getEnv).toHaveBeenCalledWith("TEST_KEY");
      expect(result).toBe("test-value");
    });

    it("should delegate hasAsyncLocalStorage to inner adapter", () => {
      const mockInner = { hasAsyncLocalStorage: jest.fn(() => true) };
      (adapter as unknown as { inner: unknown }).inner = mockInner;

      const result = adapter.hasAsyncLocalStorage();
      expect(mockInner.hasAsyncLocalStorage).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should delegate createAsyncLocalStorage to inner adapter", () => {
      const mockALS = { getStore: jest.fn(), run: jest.fn() };
      const mockInner = { createAsyncLocalStorage: jest.fn(() => mockALS) };
      (adapter as unknown as { inner: unknown }).inner = mockInner;

      const result = adapter.createAsyncLocalStorage();
      expect(mockInner.createAsyncLocalStorage).toHaveBeenCalled();
      expect(result).toBe(mockALS);
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
