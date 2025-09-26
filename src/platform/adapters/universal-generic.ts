import type { IAsyncLocalStorage, IPlatformAdapter } from "../types";
import { platformUnsupportedFunctionError } from "../../errors";

// A generic, non-detecting adapter that uses globalThis listeners and no Node APIs.
export class GenericUniversalPlatformAdapter implements IPlatformAdapter {
  readonly id = "universal" as const;
  async init() {}

  onUncaughtException(handler: (error: any) => void) {
    const tgt: any = globalThis as any;
    if (tgt.addEventListener) {
      const h = (e: any) => handler(e?.error ?? e);
      tgt.addEventListener("error", h);
      return () => tgt.removeEventListener?.("error", h);
    }
    return () => {};
  }

  onUnhandledRejection(handler: (reason: any) => void) {
    const tgt: any = globalThis as any;
    if (tgt.addEventListener) {
      const wrap = (e: any) => handler(e?.reason ?? e);
      tgt.addEventListener("unhandledrejection", wrap);
      return () => tgt.removeEventListener?.("unhandledrejection", wrap);
    }
    return () => {};
  }

  onShutdownSignal(handler: () => void) {
    const tgt: any = globalThis as any;
    if (tgt.addEventListener) {
      const handlers: { before?: any; visibility?: any } = {};
      handlers.before = (e?: any) => handler();
      tgt.addEventListener("beforeunload", handlers.before);

      const doc: any = (globalThis as any).document;
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
    const g: any = globalThis as any;
    if (g.__ENV__ && typeof g.__ENV__ === "object") return g.__ENV__[key];
    if (typeof process !== "undefined" && (process as any).env)
      return (process as any).env[key];
    if (g.env && typeof g.env === "object") return g.env[key];
    return undefined;
  }

  hasAsyncLocalStorage(): boolean {
    return false;
  }

  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T> {
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
