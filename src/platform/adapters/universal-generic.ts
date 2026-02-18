import type { IAsyncLocalStorage, IPlatformAdapter } from "../types";
import { platformUnsupportedFunctionError } from "../../errors";

// A generic, non-detecting adapter that uses globalThis listeners and no Node APIs.
export class GenericUniversalPlatformAdapter implements IPlatformAdapter {
  readonly id = "universal" as const;
  private alsClass: (new <T>() => IAsyncLocalStorage<T>) | null = null;
  private alsProbed = false;

  async init() {}

  private probeAsyncLocalStorage(): void {
    if (this.alsProbed) return;
    this.alsProbed = true;

    const g = globalThis as Record<string, unknown>;

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

  onUncaughtException(handler: (error: any) => void) {
    const tgt = globalThis as Record<string, any>;
    if (tgt.addEventListener) {
      const h = (e: any) => handler(e?.error ?? e);
      tgt.addEventListener("error", h);
      return () => tgt.removeEventListener?.("error", h);
    }
    return () => {};
  }

  onUnhandledRejection(handler: (reason: any) => void) {
    const tgt = globalThis as Record<string, any>;
    if (tgt.addEventListener) {
      const wrap = (e: any) => handler(e?.reason ?? e);
      tgt.addEventListener("unhandledrejection", wrap);
      return () => tgt.removeEventListener?.("unhandledrejection", wrap);
    }
    return () => {};
  }

  onShutdownSignal(handler: () => void) {
    const tgt = globalThis as Record<string, any>;
    if (tgt.addEventListener) {
      const handlers: { before?: any; visibility?: any } = {};
      handlers.before = (_e?: any) => handler();
      tgt.addEventListener("beforeunload", handlers.before);

      const doc = (globalThis as Record<string, any>).document;
      if (doc) {
        handlers.visibility = () => {
          if (doc.visibilityState === "hidden") handler();
        };
        tgt.addEventListener?.("visibilitychange", handlers.visibility);
      }

      return () => {
        tgt.removeEventListener?.("beforeunload", handlers.before);
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
    const g = globalThis as Record<string, any>;
    if (g.__ENV__ && typeof g.__ENV__ === "object") return g.__ENV__[key];
    if (
      typeof process !== "undefined" &&
      (process as { env: Record<string, string> }).env
    )
      return (process as { env: Record<string, string> }).env[key];
    if (g.env && typeof g.env === "object") return g.env[key];
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
      getStore: (): any => {
        platformUnsupportedFunctionError.throw({
          functionName: "createAsyncLocalStorage",
        });
      },
      run: (_store: any, _callback: () => any): any => {
        platformUnsupportedFunctionError.throw({
          functionName: "createAsyncLocalStorage",
        });
      },
    };
  }

  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
}
