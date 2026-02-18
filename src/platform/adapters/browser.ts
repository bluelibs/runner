import type {
  IAsyncLocalStorage,
  IPlatformAdapter,
  PlatformId,
} from "../types";
import { platformUnsupportedFunctionError } from "../../errors";

/**
 * Interface representing a browser-like event target with optional event methods.
 * These are optional because they may not exist in all environments (e.g., Node.js).
 */
interface BrowserEventTarget {
  addEventListener?(type: string, listener: EventListener): void;
  removeEventListener?(type: string, listener: EventListener): void;
}

/**
 * Interface representing a browser document with visibility state.
 */
interface BrowserDocument {
  visibilityState?: "visible" | "hidden" | "prerender";
}

/**
 * Interface for browser global scope with window, document, and env access.
 */
interface BrowserGlobalScope extends BrowserEventTarget {
  window?: BrowserEventTarget;
  document?: BrowserDocument;
  __ENV__?: Record<string, string>;
  env?: Record<string, string>;
}

export class BrowserPlatformAdapter implements IPlatformAdapter {
  readonly id: PlatformId = "browser";
  async init() {}

  onUncaughtException(handler: (error: unknown) => void) {
    const g = globalThis as BrowserGlobalScope;
    const target: BrowserEventTarget = g.window ?? g;
    const h: EventListener = (e) => {
      // Pass through the error property if it exists, otherwise the raw event
      // Runtime may receive non-Error values from browser events
      const errorEvent = e as ErrorEvent;
      handler(errorEvent?.error ?? e);
    };
    target.addEventListener?.("error", h);
    return () => target.removeEventListener?.("error", h);
  }

  onUnhandledRejection(handler: (reason: unknown) => void) {
    const g = globalThis as BrowserGlobalScope;
    const target: BrowserEventTarget = g.window ?? g;
    const wrap: EventListener = (e) =>
      handler((e as PromiseRejectionEvent)?.reason ?? e);
    target.addEventListener?.("unhandledrejection", wrap);
    return () => target.removeEventListener?.("unhandledrejection", wrap);
  }

  onShutdownSignal(handler: () => void) {
    const g = globalThis as BrowserGlobalScope;
    const win: BrowserEventTarget = g.window ?? g;
    const handlers: { before?: EventListener; visibility?: EventListener } = {};

    handlers.before = () => handler();
    win.addEventListener?.("beforeunload", handlers.before);

    const doc = g.document;
    if (doc && typeof win.addEventListener === "function") {
      handlers.visibility = () => {
        if (doc.visibilityState === "hidden") handler();
      };
      win.addEventListener?.("visibilitychange", handlers.visibility);
    }

    return () => {
      if (handlers.before)
        win.removeEventListener?.("beforeunload", handlers.before);
      if (handlers.visibility)
        win.removeEventListener?.("visibilitychange", handlers.visibility);
    };
  }

  exit() {
    platformUnsupportedFunctionError.throw({ functionName: "exit" });
  }

  getEnv(key: string) {
    const g = globalThis as BrowserGlobalScope;
    if (g.__ENV__ && typeof g.__ENV__ === "object") return g.__ENV__[key];
    if (
      typeof process !== "undefined" &&
      (process as { env: Record<string, string> }).env
    )
      return (process as { env: Record<string, string> }).env[key];
    if (g.env && typeof g.env === "object") return g.env[key];
    return undefined;
  }

  hasAsyncLocalStorage() {
    return false;
  }

  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T> {
    // Return a wrapper that throws on use; creation itself shouldn't crash callers
    const throwUnsupported = (): never => {
      return platformUnsupportedFunctionError.throw({
        functionName: "createAsyncLocalStorage",
      });
    };

    return {
      getStore: (): T | undefined => throwUnsupported(),
      run: <R>(_store: T, _callback: () => R): R => throwUnsupported(),
    };
  }

  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
}
