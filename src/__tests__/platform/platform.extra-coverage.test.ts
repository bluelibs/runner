import { PlatformAdapter } from "../../platform";
import { platformUnsupportedFunctionError } from "../../errors";

// Capture baseline globals to restore after each test in this file
const baselineAdd = (globalThis as any).addEventListener;
const baselineRemove = (globalThis as any).removeEventListener;
const baselineWindow = (globalThis as any).window;

describe("Platform extra coverage", () => {
  afterEach(() => {
    // Restore any globals we may have modified
    (globalThis as any).addEventListener = baselineAdd;
    (globalThis as any).removeEventListener = baselineRemove;
    (globalThis as any).window = baselineWindow;
  });

  it("constructs without explicit env and detects environment", () => {
    const adapter = new PlatformAdapter();
    expect(["node", "browser", "universal"]).toContain(adapter.env);
  });

  it("browser fallback uses globalThis when window is missing; error handler receives raw event and cleanup removes listener", () => {
    const adapter = new PlatformAdapter("browser");

    // Force using globalThis by ensuring window is undefined
    const originalWindow = (globalThis as any).window;
    delete (globalThis as any).window;

    let storedListener: any;
    const addSpy = jest.fn((evt: string, fn: any) => {
      if (evt === "error") storedListener = fn;
    });
    const removeSpy = jest.fn();
    const originalAdd = (globalThis as any).addEventListener;
    const originalRemove = (globalThis as any).removeEventListener;
    (globalThis as any).addEventListener = addSpy as any;
    (globalThis as any).removeEventListener = removeSpy as any;

    let captured: any;
    const cleanup = adapter.onUncaughtException((e) => {
      captured = e;
    });

    expect(addSpy).toHaveBeenCalledWith("error", expect.any(Function));

    // Trigger with raw value (no .error on the event)
    storedListener?.("boom");
    expect(captured).toBe("boom");

    cleanup();
    expect(removeSpy).toHaveBeenCalledWith("error", expect.any(Function));

    // Restore
    (globalThis as any).addEventListener = originalAdd;
    (globalThis as any).removeEventListener = originalRemove;
    (globalThis as any).window = originalWindow;
  });

  it("universal error listener handles raw event and cleanup removes listener", () => {
    const adapter = new PlatformAdapter("universal");

    let storedListener: any;
    const originalAdd = (globalThis as any).addEventListener;
    const originalRemove = (globalThis as any).removeEventListener;
    (globalThis as any).addEventListener = ((evt: string, fn: Function) => {
      if (evt === "error") storedListener = fn;
    }) as any;
    const removeSpy = jest.fn();
    (globalThis as any).removeEventListener = removeSpy as any;

    let received: any;
    const cleanup = adapter.onUncaughtException((e) => {
      received = e;
    });

    storedListener?.("plain");
    expect(received).toBe("plain");

    cleanup();
    expect(removeSpy).toHaveBeenCalledWith("error", expect.any(Function));

    (globalThis as any).addEventListener = originalAdd;
    (globalThis as any).removeEventListener = originalRemove;
  });

  it("universal unhandledrejection listener handles event without reason", () => {
    const adapter = new PlatformAdapter("universal");

    let storedListener: any;
    const originalAdd = (globalThis as any).addEventListener;
    const removeSpy = jest.fn();
    (globalThis as any).removeEventListener = removeSpy as any;
    (globalThis as any).addEventListener = ((evt: string, fn: Function) => {
      if (evt === "unhandledrejection") storedListener = fn;
    }) as any;

    let received: any;
    const cleanup = adapter.onUnhandledRejection((reason) => {
      received = reason;
    });

    storedListener?.("no-reason");
    expect(received).toBe("no-reason");

    cleanup();

    (globalThis as any).addEventListener = originalAdd;
  });

  it("node createAsyncLocalStorage hydrates even when init wasn't awaited", () => {
    const adapter = new PlatformAdapter("node");
    const als = adapter.createAsyncLocalStorage();
    expect(als.getStore()).toBeUndefined();
    expect(() => als.run(new Map(), () => undefined)).not.toThrow();
  });
});
