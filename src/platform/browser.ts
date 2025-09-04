/**
 * Browser Platform Adapter
 * Implements platform APIs using browser-compatible Web APIs.
 */
import type { IPlatformAdapter, IAsyncLocalStorage } from "./types";
import { PlatformUnsupportedFunction } from "../errors";

export class BrowserPlatformAdapter implements IPlatformAdapter {
  onUncaughtException(handler: (error: any) => void): () => void {
    const listener = (event: ErrorEvent) => handler(event.error);
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("error", listener as any);
      return () => window.removeEventListener("error", listener as any);
    }
    // Fallback to globalThis if window is not available
    (globalThis as any).addEventListener?.("error", listener);
    return () => (globalThis as any).removeEventListener?.("error", listener);
  }

  onUnhandledRejection(handler: (reason: any) => void): () => void {
    const listener = (event: PromiseRejectionEvent) => handler(event.reason);
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("unhandledrejection", listener as any);
      return () =>
        window.removeEventListener("unhandledrejection", listener as any);
    }
    (globalThis as any).addEventListener?.("unhandledrejection", listener);
    return () =>
      (globalThis as any).removeEventListener?.("unhandledrejection", listener);
  }

  onShutdownSignal(handler: () => void): () => void {
    const beforeUnloadListener = () => handler();
    const visibilityListener = () => {
      const doc = typeof document !== "undefined" ? document : undefined;
      if (doc?.visibilityState === "hidden") handler();
    };

    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("beforeunload", beforeUnloadListener as any);
      window.addEventListener("visibilitychange", visibilityListener as any);
      return () => {
        window.removeEventListener("beforeunload", beforeUnloadListener as any);
        window.removeEventListener(
          "visibilitychange",
          visibilityListener as any,
        );
      };
    }

    (globalThis as any).addEventListener?.(
      "beforeunload",
      beforeUnloadListener,
    );
    (globalThis as any).addEventListener?.(
      "visibilitychange",
      visibilityListener,
    );
    return () => {
      (globalThis as any).removeEventListener?.(
        "beforeunload",
        beforeUnloadListener,
      );
      (globalThis as any).removeEventListener?.(
        "visibilitychange",
        visibilityListener,
      );
    };
  }

  exit(code: number): void {
    throw new PlatformUnsupportedFunction(`exit(${code})`);
  }

  getEnv(key: string): string | undefined {
    return (
      (globalThis as any).__ENV__?.[key] ||
      (globalThis as any).process?.env?.[key] ||
      (globalThis as any).env?.[key]
    );
  }

  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T> {
    // Best-effort polyfill using a context token on globalThis
    const contexts = new WeakMap<object, T>();
    const contextSymbol = Symbol("asyncContext");

    return {
      getStore(): T | undefined {
        const ctx = (globalThis as any)[contextSymbol];
        return ctx ? contexts.get(ctx) : undefined;
      },
      run<R>(store: T, callback: () => R): R {
        const ctx = {};
        contexts.set(ctx, store);
        const previous = (globalThis as any)[contextSymbol];
        (globalThis as any)[contextSymbol] = ctx;

        let restored = false;
        const restore = () => {
          if (!restored) {
            (globalThis as any)[contextSymbol] = previous;
            restored = true;
          }
        };

        try {
          const result = callback();
          const maybePromise = result as any;
          if (maybePromise && typeof maybePromise.then === "function") {
            return maybePromise.finally(restore);
          }
          restore();
          return result;
        } catch (e) {
          restore();
          throw e;
        }
      },
    };
  }

  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
}
