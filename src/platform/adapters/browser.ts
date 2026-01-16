import type {
  IAsyncLocalStorage,
  IPlatformAdapter,
  PlatformId,
} from "../types";
import { platformUnsupportedFunctionError } from "../../errors";

export class BrowserPlatformAdapter implements IPlatformAdapter {
  readonly id: PlatformId = "browser";
  async init() {}

  onUncaughtException(handler: (error: any) => void) {
    const target =
      (globalThis as unknown as Record<string, any>).window ?? globalThis;
    const h = (e: any) => handler(e?.error ?? e);
    (target as any).addEventListener?.("error", h as any);
    return () => (target as any).removeEventListener?.("error", h as any);
  }

  onUnhandledRejection(handler: (reason: any) => void) {
    const target =
      (globalThis as unknown as Record<string, any>).window ?? globalThis;
    const wrap = (e: any) => handler(e?.reason ?? e);
    (target as any).addEventListener?.("unhandledrejection", wrap as any);
    return () =>
      (target as any).removeEventListener?.("unhandledrejection", wrap as any);
  }

  onShutdownSignal(handler: () => void) {
    const win =
      (globalThis as unknown as Record<string, any>).window ?? globalThis;
    const handlers: { before?: any; visibility?: any } = {};

    handlers.before = (e?: any) => handler();
    (win as any).addEventListener?.("beforeunload", handlers.before);

    const doc = (globalThis as unknown as Record<string, any>).document;
    if (doc && typeof (win as any).addEventListener === "function") {
      handlers.visibility = () => {
        if ((doc as any).visibilityState === "hidden") handler();
      };
      (win as any).addEventListener?.("visibilitychange", handlers.visibility);
    }

    return () => {
      (win as any).removeEventListener?.("beforeunload", handlers.before);
      if (handlers.visibility)
        (win as any).removeEventListener?.("visibilitychange", handlers.visibility);
    };
  }

  exit() {
    platformUnsupportedFunctionError.throw({ functionName: "exit" });
  }

  getEnv(key: string) {
    const g = globalThis as unknown as Record<string, any>;
    if (g.__ENV__ && typeof g.__ENV__ === "object") return g.__ENV__[key];
    if (
      typeof process !== "undefined" &&
      (process as unknown as { env: Record<string, string> }).env
    )
      return (process as unknown as { env: Record<string, string> }).env[key];
    if (g.env && typeof g.env === "object") return g.env[key];
    return undefined;
  }

  hasAsyncLocalStorage() {
    return false;
  }

  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T> {
    // Return a wrapper that throws on use; creation itself shouldn't crash callers
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
