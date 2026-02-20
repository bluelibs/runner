import type { IAsyncLocalStorage, IPlatformAdapter } from "../types";
import { platformUnsupportedFunctionError } from "../../errors";
import { normalizeError } from "../../globals/resources/tunnel/error-utils";

interface GenericEventTarget extends Record<string, unknown> {
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener?: (
    type: string,
    listener: (event: unknown) => void,
  ) => void;
  document?: { visibilityState?: unknown };
}

// A generic, non-detecting adapter that uses globalThis listeners and no Node APIs.
export class GenericUniversalPlatformAdapter implements IPlatformAdapter {
  readonly id = "universal" as const;
  private alsClass: (new <T>() => IAsyncLocalStorage<T>) | null = null;
  private alsProbed = false;

  async init() {}

  private probeAsyncLocalStorage(): void {
    if (this.alsProbed) return;
    this.alsProbed = true;

    const g = globalThis as GenericEventTarget;

    // Keep universal behavior unchanged for non-Deno runtimes.
    if (typeof g.Deno === "undefined") return;

    if (typeof g.AsyncLocalStorage === "function") {
      this.alsClass = g.AsyncLocalStorage as new <T>() => IAsyncLocalStorage<T>;
      return;
    }

    try {
      // Prefer node:async_hooks compat when available in Deno.
      const mod = require("node:async_hooks") as {
        AsyncLocalStorage?: new <T>() => IAsyncLocalStorage<T>;
      };
      if (mod?.AsyncLocalStorage) {
        this.alsClass = mod.AsyncLocalStorage;
      }
    } catch {
      // Unsupported in this runtime; fallback remains unsupported.
    }
  }

  onUncaughtException(handler: (error: unknown) => void) {
    const tgt = globalThis as GenericEventTarget;
    if (tgt.addEventListener) {
      const h = (event: unknown) => {
        const error =
          event &&
          typeof event === "object" &&
          "error" in event &&
          (event as { error?: unknown }).error !== undefined
            ? (event as { error?: unknown }).error
            : event;
        handler(normalizeError(error));
      };
      tgt.addEventListener("error", h);
      return () => tgt.removeEventListener?.("error", h);
    }
    return () => {};
  }

  onUnhandledRejection(handler: (reason: unknown) => void) {
    const tgt = globalThis as GenericEventTarget;
    if (tgt.addEventListener) {
      const wrap = (event: unknown) => {
        const reason =
          event &&
          typeof event === "object" &&
          "reason" in event &&
          (event as { reason?: unknown }).reason !== undefined
            ? (event as { reason?: unknown }).reason
            : event;
        handler(reason);
      };
      tgt.addEventListener("unhandledrejection", wrap);
      return () => tgt.removeEventListener?.("unhandledrejection", wrap);
    }
    return () => {};
  }

  onShutdownSignal(handler: () => void) {
    const tgt = globalThis as GenericEventTarget;
    if (tgt.addEventListener) {
      const handlers: {
        before?: () => void;
        visibility?: () => void;
      } = {};
      handlers.before = () => handler();
      tgt.addEventListener("beforeunload", handlers.before);

      const doc = tgt.document;
      if (doc) {
        handlers.visibility = () => {
          if (doc.visibilityState === "hidden") handler();
        };
        tgt.addEventListener?.("visibilitychange", handlers.visibility);
      }

      return () => {
        if (handlers.before) {
          tgt.removeEventListener?.("beforeunload", handlers.before);
        }
        if (handlers.visibility)
          tgt.removeEventListener?.("visibilitychange", handlers.visibility);
      };
    }
    return () => {};
  }

  exit(): void {
    platformUnsupportedFunctionError.throw({ functionName: "exit" });
  }

  getEnv(key: string): string | undefined {
    const g = globalThis as GenericEventTarget;
    if (g.__ENV__ && typeof g.__ENV__ === "object") {
      return (g.__ENV__ as Record<string, string | undefined>)[key];
    }
    if (
      typeof process !== "undefined" &&
      (process as { env: Record<string, string> }).env
    )
      return (process as { env: Record<string, string> }).env[key];
    if (g.env && typeof g.env === "object") {
      return (g.env as Record<string, string | undefined>)[key];
    }
    return undefined;
  }

  hasAsyncLocalStorage(): boolean {
    this.probeAsyncLocalStorage();
    return this.alsClass !== null;
  }

  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T> {
    this.probeAsyncLocalStorage();
    if (this.alsClass) {
      return new this.alsClass<T>();
    }

    // Construct without throw; error only when used
    return {
      getStore: (): T | undefined => {
        return platformUnsupportedFunctionError.throw({
          functionName: "createAsyncLocalStorage",
        });
      },
      run: <R>(_store: T, _callback: () => R): R => {
        return platformUnsupportedFunctionError.throw({
          functionName: "createAsyncLocalStorage",
        });
      },
    };
  }

  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
}
