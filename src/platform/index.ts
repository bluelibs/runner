/**
 * Unified Platform Adapter
 * Single adapter that switches behavior based on detected environment.
 */

import type { IPlatformAdapter, IAsyncLocalStorage } from "./types";
import { PlatformUnsupportedFunction } from "../errors";

export type PlatformEnv = "node" | "browser" | "universal";

export function detectEnvironment(): PlatformEnv {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    return "browser";
  }
  if (
    typeof process !== "undefined" &&
    (process as any).versions &&
    (process as any).versions.node
  ) {
    return "node";
  }
  return "universal";
}

export class PlatformAdapter implements IPlatformAdapter {
  readonly env: PlatformEnv;
  private isInitialized = false;
  private nodeALSClass: any | null = null;

  constructor(env?: PlatformEnv) {
    this.env = env ?? detectEnvironment();
  }

  async init() {
    if (this.env === "node") {
      this.nodeALSClass = (await import("node:async_hooks")).AsyncLocalStorage;
    }
  }

  onUncaughtException(handler: (error: any) => void): () => void {
    switch (this.env) {
      case "node": {
        process.on("uncaughtException", handler as any);
        return () => process.off("uncaughtException", handler as any);
      }
      case "browser": {
        const target: any = (globalThis as any).window ?? globalThis;
        const h = (e: any) => handler(e?.error ?? e);
        target.addEventListener?.("error", h);
        return () => target.removeEventListener?.("error", h);
      }
      default: {
        const tgt: any = globalThis as any;
        if (tgt.addEventListener) {
          const h = (e: any) => handler(e?.error ?? e);
          tgt.addEventListener("error", h);
          return () => tgt.removeEventListener("error", h);
        }
        return () => {};
      }
    }
  }

  onUnhandledRejection(handler: (reason: any) => void): () => void {
    switch (this.env) {
      case "node": {
        const h = (reason: any) => handler(reason);
        process.on("unhandledRejection", h);
        return () => process.off("unhandledRejection", h);
      }
      case "browser": {
        const target: any = (globalThis as any).window;
        const wrap = (e: any) => handler(e.reason);
        target.addEventListener?.("unhandledrejection", wrap);
        return () => target.removeEventListener?.("unhandledrejection", wrap);
      }
      default: {
        const tgt: any = globalThis as any;
        if (tgt.addEventListener) {
          const wrap = (e: any) => handler(e.reason ?? e);
          tgt.addEventListener("unhandledrejection", wrap);
          return () => tgt.removeEventListener("unhandledrejection", wrap);
        }
        return () => {};
      }
    }
  }

  onShutdownSignal(handler: () => void): () => void {
    switch (this.env) {
      case "node": {
        process.on("SIGINT", handler);
        process.on("SIGTERM", handler);
        return () => {
          process.off("SIGINT", handler);
          process.off("SIGTERM", handler);
        };
      }
      case "browser": {
        const win: any = window;
        const doc: any = document;
        win.addEventListener?.("beforeunload", handler);
        return () => {
          win.removeEventListener?.("beforeunload", handler);
        };
      }
      default: {
        const tgt: any = globalThis as any;
        const cleanup: Array<() => void> = [];
        if (tgt.addEventListener) {
          tgt.addEventListener("beforeunload", handler);
          cleanup.push(() =>
            tgt.removeEventListener?.("beforeunload", handler),
          );
          const vis = () => {
            const doc: any = (globalThis as any).document;
            if (doc && doc.visibilityState === "hidden") handler();
          };
          tgt.addEventListener("visibilitychange", vis);
          cleanup.push(() =>
            tgt.removeEventListener?.("visibilitychange", vis),
          );
        }
        if (typeof process !== "undefined" && (process as any).on) {
          (process as any).on("SIGINT", handler);
          (process as any).on("SIGTERM", handler);
          cleanup.push(() => {
            (process as any).off?.("SIGINT", handler);
            (process as any).off?.("SIGTERM", handler);
          });
        }
        return () => cleanup.forEach((fn) => fn());
      }
    }
  }

  exit(code: number): void {
    switch (this.env) {
      case "node":
        process.exit(code);
        return;
      default:
        throw new PlatformUnsupportedFunction("exit");
    }
  }

  getEnv(key: string): string | undefined {
    switch (this.env) {
      case "node":
        return process.env[key];
      default: {
        const g: any = globalThis as any;
        if (g.__ENV__ && typeof g.__ENV__ === "object") return g.__ENV__[key];
        if (typeof process !== "undefined" && (process as any).env)
          return (process as any).env[key];
        if (g.env && typeof g.env === "object") return g.env[key];
        return undefined;
      }
    }
  }

  hasAsyncLocalStorage(): boolean {
    switch (this.env) {
      case "node":
        return true; // We'll try native, else polyfill
      case "browser":
      default:
        return false; // Keep behavior strict for universal
    }
  }

  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T> {
    switch (this.env) {
      case "node": {
        let instance: IAsyncLocalStorage<T> | undefined;
        const get = (): IAsyncLocalStorage<T> => {
          if (!instance) {
            if (!this.nodeALSClass) {
              throw new PlatformUnsupportedFunction(
                "createAsyncLocalStorage: Platform not initialized",
              );
            }
            instance = new this.nodeALSClass();
          }

          return instance!;
        };

        return {
          getStore: () => get().getStore(),
          run: (store: T, callback: () => any) => get().run(store, callback),
        };
      }
      case "browser":
      default:
        return {
          getStore: () => {
            throw new PlatformUnsupportedFunction("createAsyncLocalStorage");
          },
          run: () => {
            throw new PlatformUnsupportedFunction("createAsyncLocalStorage");
          },
        };
    }
  }

  // timers
  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
}

// Singleton management
let platformInstance: IPlatformAdapter | null = null;
let detectedEnvironment: PlatformEnv | null = null;

export function getPlatform(): IPlatformAdapter {
  if (!platformInstance) {
    const env = detectEnvironment();
    detectedEnvironment = env;
    platformInstance = new PlatformAdapter(env);
  }
  return platformInstance;
}

export function setPlatform(adapter: IPlatformAdapter): void {
  platformInstance = adapter;
  detectedEnvironment = "manual" as any;
}

export function resetPlatform(): void {
  platformInstance = null;
  detectedEnvironment = null;
}

export function getDetectedEnvironment(): PlatformEnv {
  if (!detectedEnvironment) detectedEnvironment = detectEnvironment();
  return detectedEnvironment;
}

export function isNode(): boolean {
  return getDetectedEnvironment() === "node";
}

export function isBrowser(): boolean {
  return getDetectedEnvironment() === "browser";
}

export function isUniversal(): boolean {
  return getDetectedEnvironment() === "universal";
}

// Re-export types
export type { IPlatformAdapter, IAsyncLocalStorage } from "./types";
