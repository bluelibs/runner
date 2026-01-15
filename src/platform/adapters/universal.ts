import type { IPlatformAdapter, PlatformId } from "../types";
import { BrowserPlatformAdapter } from "./browser";
import { EdgePlatformAdapter } from "./edge";
import { NodePlatformAdapter } from "./node";
import { GenericUniversalPlatformAdapter } from "./universal-generic";

export function detectEnvironment(): PlatformId {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    return "browser";
  }

  const global = globalThis as unknown as {
    process?: { versions?: { node?: string; bun?: string } };
    Deno?: unknown;
    Bun?: unknown;
    importScripts?: unknown;
    WorkerGlobalScope?: unknown;
    document?: unknown;
    addEventListener?: unknown;
  };

  if (global.process?.versions?.node) {
    return "node";
  }

  if (typeof global.Deno !== "undefined") {
    return "universal";
  }

  if (typeof global.Bun !== "undefined" || global.process?.versions?.bun) {
    return "universal";
  }

  // Heuristics for WebWorker-like environments
  if (
    typeof global.importScripts === "function" &&
    typeof window === "undefined"
  ) {
    return "edge";
  }

  if (
    typeof global.WorkerGlobalScope !== "undefined" &&
    typeof self !== "undefined" &&
    self instanceof (global.WorkerGlobalScope as any)
  ) {
    return "edge";
  }

  return "universal";
}

export class UniversalPlatformAdapter implements IPlatformAdapter {
  readonly id: PlatformId = "universal";
  private inner: IPlatformAdapter | null = null;

  async init() {
    this.ensureInner();
    await this.inner!.init();
  }

  private ensureInner() {
    if (this.inner) return;

    const kind = detectEnvironment();
    const global = globalThis as unknown as {
      document?: unknown;
      addEventListener?: unknown;
    };

    if (
      typeof global.document !== "undefined" ||
      typeof global.addEventListener === "function"
    ) {
      this.inner = new BrowserPlatformAdapter();
    } else {
      switch (kind) {
        case "node":
          this.inner = new NodePlatformAdapter();
          break;
        case "edge":
          this.inner = new EdgePlatformAdapter();
          break;
        default:
          // Covers "browser" (unreachable - would hit first if), "universal", and future cases
          this.inner = new GenericUniversalPlatformAdapter();
      }
    }
  }

  private get() {
    this.ensureInner();
    return this.inner!;
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
