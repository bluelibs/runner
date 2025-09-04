/**
 * @jest-environment jsdom
 */

class FakePromiseRejectionEvent extends Event {
  promise: Promise<any>;
  reason: any;

  constructor(type: string, init: { promise: Promise<any>; reason: any }) {
    super(type);
    this.promise = init.promise;
    this.reason = init.reason;
  }
}

(global as any).PromiseRejectionEvent = FakePromiseRejectionEvent;

import { detectEnvironment, PlatformAdapter } from "../../platform";
import { createContext, storage } from "../../context";
import { PlatformUnsupportedFunction } from "../../errors";
import exp from "constants";
describe("PlatformAdapter (Browser)", () => {
  it("should register and cleanup error listeners", () => {
    const adapter = new PlatformAdapter("browser");

    expect(detectEnvironment()).toBe("browser");
    expect(storage).toBeDefined();
    expect(() => createContext("test")).toThrow(PlatformUnsupportedFunction);
    expect(() => storage.getStore()).toThrow(PlatformUnsupportedFunction);
    expect(() => storage.run(new Map(), () => {})).toThrow(
      PlatformUnsupportedFunction,
    );

    expect(adapter.hasAsyncLocalStorage()).toBe(false);
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

  it("should handle unhandled rejection with globalThis fallback", () => {
    const adapter = new PlatformAdapter("browser");

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
    const adapter = new PlatformAdapter("browser");

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

    cleanup();
    expect(removeSpy).toHaveBeenCalledWith(
      "beforeunload",
      expect.any(Function),
    );
    (globalThis as any).addEventListener = originalAdd;
    (globalThis as any).removeEventListener = originalRemove;
    (globalThis as any).window = originalWindow;
  });

  it("should throw on exit", () => {
    const adapter = new PlatformAdapter("browser");
    expect(() => adapter.exit(0)).toThrow();
  });

  it("should support env fallbacks", () => {
    const adapter = new PlatformAdapter("browser");
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

  it("does not invoke shutdown handler when document is undefined on visibilitychange", () => {
    const adapter = new PlatformAdapter("browser");

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

  it("should handle unhandled rejection with window defined", () => {
    const adapter = new PlatformAdapter("browser");

    let flag = jest.fn();

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
