import type { IPlatformAdapter } from "../types";
import { BrowserPlatformAdapter } from "./browser";
import { EdgePlatformAdapter } from "./edge";
import { NodePlatformAdapter } from "./node";
import { GenericUniversalPlatformAdapter } from "./universal-generic";

export type PlatformEnv = "node" | "browser" | "edge" | "universal" | "manual";

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

  if (typeof (globalThis as any).Deno !== "undefined") {
    return "universal";
  }

  if (
    typeof (globalThis as any).Bun !== "undefined" ||
    (typeof process !== "undefined" && (process as any).versions?.bun)
  ) {
    return "universal";
  }

  if (
    typeof (globalThis as any).WorkerGlobalScope !== "undefined" &&
    typeof self !== "undefined" &&
    self instanceof (globalThis as any).WorkerGlobalScope
  ) {
    return "edge";
  }

  return "universal";
}

export class UniversalPlatformAdapter implements IPlatformAdapter {
  private inner: IPlatformAdapter | null = null;

  async init() {
    if (!this.inner) {
      const kind = detectEnvironment();
      if (
        typeof (globalThis as any).document !== "undefined" ||
        typeof (globalThis as any).addEventListener === "function"
      ) {
        this.inner = new BrowserPlatformAdapter();
      } else {
        switch (kind) {
          case "node":
            this.inner = new NodePlatformAdapter();
            break;
          // istanbul ignore next: this branch is unreachable in practice because detectEnvironment()
          // returns "browser" only when document is defined; we keep it for completeness.
          case "browser":
            this.inner = new BrowserPlatformAdapter();
            break;
          case "edge":
            this.inner = new EdgePlatformAdapter();
            break;
          default:
            this.inner = new GenericUniversalPlatformAdapter();
        }
      }
    }
    await this.inner!.init();
  }

  private get() {
    if (!this.inner) {
      const kind = detectEnvironment();
      if (
        typeof (globalThis as any).document !== "undefined" ||
        typeof (globalThis as any).addEventListener === "function"
      ) {
        this.inner = new BrowserPlatformAdapter();
      } else {
        switch (kind) {
          case "node":
            this.inner = new NodePlatformAdapter();
            break;
          // istanbul ignore next: this branch is unreachable in practice because detectEnvironment()
          // returns "browser" only when document is defined; we keep it for completeness.
          case "browser":
            this.inner = new BrowserPlatformAdapter();
            break;
          case "edge":
            this.inner = new EdgePlatformAdapter();
            break;
          default:
            this.inner = new GenericUniversalPlatformAdapter();
        }
      }
    }
    return this.inner;
  }

  onUncaughtException(handler: (error: Error) => void) {
    return this.get().onUncaughtException(handler);
  }
  onUnhandledRejection(handler: (reason: unknown) => void) {
    return this.get().onUnhandledRejection(handler);
  }
  onShutdownSignal(handler: () => void) {
    return this.get().onShutdownSignal(handler);
  }
  exit(code: number) {
    return this.get().exit(code);
  }
  getEnv(key: string) {
    return this.get().getEnv(key);
  }
  hasAsyncLocalStorage() {
    return this.get().hasAsyncLocalStorage();
  }
  createAsyncLocalStorage<T>() {
    return this.get().createAsyncLocalStorage<T>();
  }
  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
}
