/**
 * @jest-environment jsdom
 */

class FakePromiseRejectionEvent extends Event {
  promise: Promise<unknown>;
  reason: unknown;

  constructor(type: string, init: { promise: Promise<unknown>; reason: unknown }) {
    super(type);
    this.promise = init.promise;
    this.reason = init.reason;
  }
}

declare global {
  interface Window {
    PromiseRejectionEvent: typeof FakePromiseRejectionEvent;
    __ENV__?: Record<string, string>;
    process?: { env: Record<string, string> };
    env?: Record<string, string>;
  }
}

(global as unknown as { PromiseRejectionEvent: unknown }).PromiseRejectionEvent =
  FakePromiseRejectionEvent;

import { detectEnvironment, PlatformAdapter } from "../../platform";
import { defineAsyncContext, storage } from "../../definers/defineAsyncContext";
describe("PlatformAdapter (Browser)", () => {
  it("should register and cleanup error listeners", () => {
    const adapter = new PlatformAdapter("browser");

    expect(detectEnvironment()).toBe("browser");
    expect(storage).toBeDefined();
    expect(() => defineAsyncContext({ id: "test" })).toThrow();
    expect(() => storage.getStore()).toThrow();
    expect(() => storage.run(new Map(), () => {})).toThrow();

    expect(adapter.hasAsyncLocalStorage()).toBe(false);
    expect(adapter.hasAsyncLocalStorage()).toBe(false);
    const originalAdd = globalThis.addEventListener;
    const originalRemove = globalThis.removeEventListener;
    const addSpy = jest.fn();
    const removeSpy = jest.fn();
    globalThis.addEventListener = addSpy;
    globalThis.removeEventListener = removeSpy;

    const cleanup = adapter.onUncaughtException(() => {});
    expect(addSpy).toHaveBeenCalledWith("error", expect.any(Function));

    cleanup();
    expect(removeSpy).toHaveBeenCalledWith("error", expect.any(Function));

    globalThis.addEventListener = originalAdd;
    globalThis.removeEventListener = originalRemove;
  });

  it("should handle unhandled rejection with globalThis fallback", () => {
    const adapter = new PlatformAdapter("browser");

    const originalAdd = globalThis.addEventListener;
    const originalRemove = globalThis.removeEventListener;
    const addSpy = jest.fn();
    const removeSpy = jest.fn();
    globalThis.addEventListener = addSpy;
    globalThis.removeEventListener = removeSpy;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { window: originalWindow, ..._rest } = globalThis as unknown as {
      window: unknown;
    };
    // Force fallback path by deleting window if it exists (in jsdom it usually does)
    delete (globalThis as unknown as { window: unknown }).window;

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

    globalThis.addEventListener = originalAdd;
    globalThis.removeEventListener = originalRemove;
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  it("should use globalThis fallback for shutdown listeners and cleanup", () => {
    const adapter = new PlatformAdapter("browser");

    const originalAdd = globalThis.addEventListener;
    const originalRemove = globalThis.removeEventListener;
    const addSpy = jest.fn();
    const removeSpy = jest.fn();
    globalThis.addEventListener = addSpy;
    globalThis.removeEventListener = removeSpy;
    const originalWindow = (globalThis as unknown as { window: unknown }).window;
    delete (globalThis as unknown as { window: unknown }).window; // force fallback path

    const cleanup = adapter.onShutdownSignal(() => {});
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));

    cleanup();
    expect(removeSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
    globalThis.addEventListener = originalAdd;
    globalThis.removeEventListener = originalRemove;
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  it("should throw on exit", () => {
    const adapter = new PlatformAdapter("browser");
    expect(() => adapter.exit(0)).toThrow();
  });

  it("should support env fallbacks", () => {
    const adapter = new PlatformAdapter("browser");
    (window as unknown as Window & { __ENV__: Record<string, string> }).__ENV__ = {
      A: "1",
    };
    expect(adapter.getEnv("A")).toBe("1");
    delete (window as unknown as Window & { __ENV__?: Record<string, string> })
      .__ENV__;

    (window as unknown as Window & { process: unknown }).process = {
      env: { A: "2" },
    };
    expect(adapter.getEnv("A")).toBe("2");
    delete (window as unknown as Window & { process?: unknown }).process;

    (window as unknown as Window & { env: unknown }).env = { A: "3" };
    expect(adapter.getEnv("A")).toBe("3");
    delete (window as unknown as Window & { env?: unknown }).env;
  });

  it("does not invoke shutdown handler when document is undefined on visibilitychange", () => {
    const adapter = new PlatformAdapter("browser");

    const originalWindow = (globalThis as unknown as { window: unknown }).window;
    const listeners: Record<string, Function> = {};
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: (evt: string, fn: Function) => (listeners[evt] = fn),
      removeEventListener: () => {},
    };

    const originalDocument = (globalThis as unknown as { document: unknown })
      .document;
    delete (globalThis as unknown as { document: unknown }).document;

    let called = false;
    adapter.onShutdownSignal(() => {
      called = true;
    });

    listeners["visibilitychange"]?.();
    expect(called).toBe(false);

    (globalThis as unknown as { document: unknown }).document = originalDocument;
    (globalThis as unknown as { window: unknown }).window = originalWindow;
  });

  it("should handle unhandled rejection with window defined", () => {
    const adapter = new PlatformAdapter("browser");

    const flag = jest.fn();

    adapter.onUnhandledRejection(() => {
      flag();
    });

    window.dispatchEvent(
      new Event("unhandledrejection", { bubbles: true, cancelable: true }),
    );

    // doReject!("My fake rejections"); // avoid unhandled rejection in test
    expect(flag).toHaveBeenCalled();
  });
});
