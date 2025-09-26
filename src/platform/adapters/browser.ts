import type { IAsyncLocalStorage, IPlatformAdapter, PlatformId } from "../types";
import { platformUnsupportedFunctionError } from "../../errors";

export class BrowserPlatformAdapter implements IPlatformAdapter {
  readonly id: PlatformId = "browser";
  async init() {}

  onUncaughtException(handler: (error: any) => void) {
    const target: any = (globalThis as any).window ?? globalThis;
    const h = (e: any) => handler(e?.error ?? e);
    target.addEventListener?.("error", h);
    return () => target.removeEventListener?.("error", h);
  }

  onUnhandledRejection(handler: (reason: any) => void) {
    const target: any = (globalThis as any).window ?? globalThis;
    const wrap = (e: any) => handler(e?.reason ?? e);
    target.addEventListener?.("unhandledrejection", wrap);
    return () => target.removeEventListener?.("unhandledrejection", wrap);
  }

  onShutdownSignal(handler: () => void) {
    const win: any = (globalThis as any).window ?? globalThis;
    const handlers: { before?: any; visibility?: any } = {};

    handlers.before = (e?: any) => handler();
    win.addEventListener?.("beforeunload", handlers.before);

    const doc: any = (globalThis as any).document;
    if (doc && typeof win.addEventListener === "function") {
      handlers.visibility = () => {
        if (doc.visibilityState === "hidden") handler();
      };
      win.addEventListener?.("visibilitychange", handlers.visibility);
    }

    return () => {
      win.removeEventListener?.("beforeunload", handlers.before);
      if (handlers.visibility) win.removeEventListener?.("visibilitychange", handlers.visibility);
    };
  }

  exit() {
    platformUnsupportedFunctionError.throw({ functionName: "exit" });
  }

  getEnv(key: string) {
    const g: any = globalThis as any;
    if (g.__ENV__ && typeof g.__ENV__ === "object") return g.__ENV__[key];
    if (typeof process !== "undefined" && (process as any).env)
      return (process as any).env[key];
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
