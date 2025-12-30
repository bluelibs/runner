import {
  UniversalPlatformAdapter,
  detectEnvironment,
} from "../../platform/adapters/universal";
import { NodePlatformAdapter } from "../../platform/adapters/node";
import { BrowserPlatformAdapter } from "../../platform/adapters/browser";
import { EdgePlatformAdapter } from "../../platform/adapters/edge";
import { GenericUniversalPlatformAdapter } from "../../platform/adapters/universal-generic";

describe("UniversalPlatformAdapter", () => {
  let adapter: UniversalPlatformAdapter;

  beforeEach(() => {
    adapter = new UniversalPlatformAdapter();
  });

  describe("detectEnvironment", () => {
    const originalWindow = (globalThis as any).window;
    const originalDocument = (globalThis as any).document;
    const originalProcess = (globalThis as any).process;
    const originalDeno = (globalThis as any).Deno;
    const originalBun = (globalThis as any).Bun;
    const originalWorkerGlobalScope = (globalThis as any).WorkerGlobalScope;
    const originalSelf = (globalThis as any).self;

    afterEach(() => {
      // Restore original values
      (globalThis as any).window = originalWindow;
      (globalThis as any).document = originalDocument;
      (globalThis as any).process = originalProcess;
      (globalThis as any).Deno = originalDeno;
      (globalThis as any).Bun = originalBun;
      (globalThis as any).WorkerGlobalScope = originalWorkerGlobalScope;
      (globalThis as any).self = originalSelf;

      // Clear any jest mocks
      jest.clearAllMocks();
      jest.restoreAllMocks();
    });

    it("should detect browser environment", () => {
      (globalThis as any).window = {};
      (globalThis as any).document = {};

      expect(detectEnvironment()).toBe("browser");
    });

    it("should detect node environment", () => {
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      (globalThis as any).process = {
        versions: { node: "18.0.0" },
      };

      expect(detectEnvironment()).toBe("node");
    });

    it("should detect Deno universal environment", () => {
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      delete (globalThis as any).process;
      (globalThis as any).Deno = {};

      expect(detectEnvironment()).toBe("universal");
    });

    it("should detect Bun universal environment via globalThis.Bun", () => {
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      delete (globalThis as any).process;
      delete (globalThis as any).Deno;
      (globalThis as any).Bun = {};

      expect(detectEnvironment()).toBe("universal");
    });

    it("should detect Bun universal environment via process.versions.bun", () => {
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      delete (globalThis as any).Deno;
      delete (globalThis as any).Bun;
      (globalThis as any).process = {
        versions: { bun: "1.0.0" },
      };

      expect(detectEnvironment()).toBe("universal");
    });

    it("should detect edge environment", () => {
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      delete (globalThis as any).process;
      delete (globalThis as any).Deno;
      delete (globalThis as any).Bun;

      const mockWorkerGlobalScope = function () {} as any;
      const mockSelf = Object.create(mockWorkerGlobalScope.prototype);

      (globalThis as any).WorkerGlobalScope = mockWorkerGlobalScope;
      (globalThis as any).self = mockSelf;

      expect(detectEnvironment()).toBe("edge");
    });

    it("should fallback to universal environment", () => {
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      delete (globalThis as any).process;
      delete (globalThis as any).Deno;
      delete (globalThis as any).Bun;
      delete (globalThis as any).WorkerGlobalScope;
      delete (globalThis as any).self;

      expect(detectEnvironment()).toBe("universal");
    });
  });

  describe("init", () => {
    it("should initialize inner adapter based on detected environment", async () => {
      await adapter.init();
      expect((adapter as any).inner).toBeDefined();
    });

    it("should not reinitialize if already initialized", async () => {
      await adapter.init();
      const firstInner = (adapter as any).inner;

      await adapter.init();
      const secondInner = (adapter as any).inner;

      expect(firstInner).toBe(secondInner);
    });

    it("should use BrowserPlatformAdapter when document exists", async () => {
      const originalDocument = (globalThis as any).document;
      (globalThis as any).document = {};

      await adapter.init();
      expect((adapter as any).inner).toBeInstanceOf(BrowserPlatformAdapter);

      (globalThis as any).document = originalDocument;
    });

    it("should use BrowserPlatformAdapter when addEventListener exists", async () => {
      const originalAddEventListener = (globalThis as any).addEventListener;
      (globalThis as any).addEventListener = () => {};

      await adapter.init();
      expect((adapter as any).inner).toBeInstanceOf(BrowserPlatformAdapter);

      (globalThis as any).addEventListener = originalAddEventListener;
    });

    it("should use different adapters based on environment in init()", async () => {
      // Test browser case in init - document exists
      const originalDocument = (globalThis as any).document;
      const originalProcess = (globalThis as any).process;

      delete (globalThis as any).process;
      (globalThis as any).document = {};

      const browserAdapter = new UniversalPlatformAdapter();
      await browserAdapter.init();
      expect((browserAdapter as any).inner).toBeInstanceOf(
        BrowserPlatformAdapter,
      );

      // Test browser case without document but with addEventListener
      delete (globalThis as any).document;
      delete (globalThis as any).process;
      const originalAdd = (globalThis as any).addEventListener;
      (globalThis as any).addEventListener = jest.fn();

      const browserAdapter2 = new UniversalPlatformAdapter();
      await browserAdapter2.init();
      expect((browserAdapter2 as any).inner).toBeInstanceOf(
        BrowserPlatformAdapter,
      );

      (globalThis as any).addEventListener = originalAdd;

      // Test node case with mock process
      delete (globalThis as any).addEventListener;
      (globalThis as any).process = {
        versions: { node: "18.0.0" },
        on: jest.fn(),
        off: jest.fn(),
      };

      const nodeAdapter = new UniversalPlatformAdapter();
      await nodeAdapter.init();
      expect((nodeAdapter as any).inner).toBeInstanceOf(NodePlatformAdapter);

      // Test explicit browser environment without document/addEventListener
      delete (globalThis as any).process;
      delete (globalThis as any).document;
      delete (globalThis as any).addEventListener;
      delete (globalThis as any).Deno;
      delete (globalThis as any).Bun;
      delete (globalThis as any).WorkerGlobalScope;
      delete (globalThis as any).self;
      (globalThis as any).window = {};
      (globalThis as any).document = {};

      const explicitBrowserAdapter = new UniversalPlatformAdapter();
      await explicitBrowserAdapter.init();
      expect((explicitBrowserAdapter as any).inner).toBeInstanceOf(
        BrowserPlatformAdapter,
      );

      // Test edge case
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      delete (globalThis as any).process;
      delete (globalThis as any).addEventListener;
      const mockWorkerGlobalScope = function () {} as any;
      const mockSelf = Object.create(mockWorkerGlobalScope.prototype);

      (globalThis as any).WorkerGlobalScope = mockWorkerGlobalScope;
      (globalThis as any).self = mockSelf;

      const edgeAdapter = new UniversalPlatformAdapter();
      await edgeAdapter.init();
      expect((edgeAdapter as any).inner).toBeInstanceOf(EdgePlatformAdapter);

      // Test default/universal case
      delete (globalThis as any).WorkerGlobalScope;
      delete (globalThis as any).self;
      delete (globalThis as any).process;
      delete (globalThis as any).document;
      delete (globalThis as any).addEventListener;
      delete (globalThis as any).Deno;
      delete (globalThis as any).Bun;

      const defaultAdapter = new UniversalPlatformAdapter();
      await defaultAdapter.init();
      expect((defaultAdapter as any).inner).toBeInstanceOf(
        GenericUniversalPlatformAdapter,
      );

      // Restore
      (globalThis as any).document = originalDocument;
      (globalThis as any).process = originalProcess;
    });
  });

  describe("lazy initialization via get()", () => {
    it("should lazily initialize inner adapter when methods are called", () => {
      const handler = jest.fn();
      adapter.onUncaughtException(handler);
      expect((adapter as any).inner).toBeDefined();
    });

    it("should use same adapter for subsequent calls", () => {
      const handler = jest.fn();
      adapter.onUncaughtException(handler);
      const firstInner = (adapter as any).inner;

      adapter.onUnhandledRejection(handler);
      const secondInner = (adapter as any).inner;

      expect(firstInner).toBe(secondInner);
    });

    it("should use different adapters based on environment in get()", () => {
      // Test browser case in get() - document exists
      const originalDocument = (globalThis as any).document;
      const originalProcess = (globalThis as any).process;

      delete (globalThis as any).process;
      (globalThis as any).document = {};

      const browserAdapter = new UniversalPlatformAdapter();
      browserAdapter.onUncaughtException(() => {});
      expect((browserAdapter as any).inner).toBeInstanceOf(
        BrowserPlatformAdapter,
      );

      // Test browser case without document but with addEventListener
      delete (globalThis as any).document;
      delete (globalThis as any).process;
      const originalAdd = (globalThis as any).addEventListener;
      (globalThis as any).addEventListener = jest.fn();

      const browserAdapter2 = new UniversalPlatformAdapter();
      browserAdapter2.onUncaughtException(() => {});
      expect((browserAdapter2 as any).inner).toBeInstanceOf(
        BrowserPlatformAdapter,
      );

      (globalThis as any).addEventListener = originalAdd;

      // Test node case with mock process
      delete (globalThis as any).addEventListener;
      (globalThis as any).process = {
        versions: { node: "18.0.0" },
        on: jest.fn(),
        off: jest.fn(),
      };

      const nodeAdapter = new UniversalPlatformAdapter();
      nodeAdapter.onUncaughtException(() => {});
      expect((nodeAdapter as any).inner).toBeInstanceOf(NodePlatformAdapter);

      // Test explicit browser environment without document/addEventListener
      delete (globalThis as any).process;
      delete (globalThis as any).document;
      delete (globalThis as any).addEventListener;
      delete (globalThis as any).Deno;
      delete (globalThis as any).Bun;
      delete (globalThis as any).WorkerGlobalScope;
      delete (globalThis as any).self;
      (globalThis as any).window = {};
      (globalThis as any).document = {};

      const explicitBrowserAdapter = new UniversalPlatformAdapter();
      explicitBrowserAdapter.onUncaughtException(() => {});
      expect((explicitBrowserAdapter as any).inner).toBeInstanceOf(
        BrowserPlatformAdapter,
      );

      // Test edge case
      delete (globalThis as any).window;
      delete (globalThis as any).document;
      delete (globalThis as any).process;
      delete (globalThis as any).addEventListener;
      const mockWorkerGlobalScope = function () {} as any;
      const mockSelf = Object.create(mockWorkerGlobalScope.prototype);

      (globalThis as any).WorkerGlobalScope = mockWorkerGlobalScope;
      (globalThis as any).self = mockSelf;

      const edgeAdapter = new UniversalPlatformAdapter();
      edgeAdapter.onUncaughtException(() => {});
      expect((edgeAdapter as any).inner).toBeInstanceOf(EdgePlatformAdapter);

      // Test default/universal case
      delete (globalThis as any).WorkerGlobalScope;
      delete (globalThis as any).self;
      delete (globalThis as any).process;
      delete (globalThis as any).document;
      delete (globalThis as any).addEventListener;
      delete (globalThis as any).Deno;
      delete (globalThis as any).Bun;

      const defaultAdapter = new UniversalPlatformAdapter();
      defaultAdapter.onUncaughtException(() => {});
      expect((defaultAdapter as any).inner).toBeInstanceOf(
        GenericUniversalPlatformAdapter,
      );

      // Restore
      (globalThis as any).document = originalDocument;
      (globalThis as any).process = originalProcess;
    });
  });

  describe("delegation methods", () => {
    it("should delegate onUncaughtException to inner adapter", () => {
      const handler = jest.fn();
      const mockInner = { onUncaughtException: jest.fn(() => () => {}) };
      (adapter as any).inner = mockInner;

      adapter.onUncaughtException(handler);
      expect(mockInner.onUncaughtException).toHaveBeenCalledWith(handler);
    });

    it("should delegate onUnhandledRejection to inner adapter", () => {
      const handler = jest.fn();
      const mockInner = { onUnhandledRejection: jest.fn(() => () => {}) };
      (adapter as any).inner = mockInner;

      adapter.onUnhandledRejection(handler);
      expect(mockInner.onUnhandledRejection).toHaveBeenCalledWith(handler);
    });

    it("should delegate onShutdownSignal to inner adapter", () => {
      const handler = jest.fn();
      const mockInner = { onShutdownSignal: jest.fn(() => () => {}) };
      (adapter as any).inner = mockInner;

      adapter.onShutdownSignal(handler);
      expect(mockInner.onShutdownSignal).toHaveBeenCalledWith(handler);
    });

    it("should delegate exit to inner adapter", () => {
      const mockInner = { exit: jest.fn() };
      (adapter as any).inner = mockInner;

      adapter.exit(1);
      expect(mockInner.exit).toHaveBeenCalledWith(1);
    });

    it("should delegate getEnv to inner adapter", () => {
      const mockInner = { getEnv: jest.fn(() => "test-value") };
      (adapter as any).inner = mockInner;

      const result = adapter.getEnv("TEST_KEY");
      expect(mockInner.getEnv).toHaveBeenCalledWith("TEST_KEY");
      expect(result).toBe("test-value");
    });

    it("should delegate hasAsyncLocalStorage to inner adapter", () => {
      const mockInner = { hasAsyncLocalStorage: jest.fn(() => true) };
      (adapter as any).inner = mockInner;

      const result = adapter.hasAsyncLocalStorage();
      expect(mockInner.hasAsyncLocalStorage).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("should delegate createAsyncLocalStorage to inner adapter", () => {
      const mockALS = { getStore: jest.fn(), run: jest.fn() };
      const mockInner = { createAsyncLocalStorage: jest.fn(() => mockALS) };
      (adapter as any).inner = mockInner;

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
