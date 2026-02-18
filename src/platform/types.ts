/**
 * Platform abstraction interface for universal compatibility
 * Inspired by Remix's approach to Web APIs and runtime-agnostic design
 */

export type PlatformId = "node" | "browser" | "edge" | "universal";
export type PlatformSetTimeout = (
  ...args: Parameters<typeof globalThis.setTimeout>
) => ReturnType<typeof globalThis.setTimeout>;
export type PlatformClearTimeout = (
  timeout: ReturnType<PlatformSetTimeout>,
) => void;

export interface IPlatformAdapter {
  readonly id: PlatformId;
  // Process management
  onUncaughtException(handler: (error: unknown) => void): () => void;
  onUnhandledRejection(handler: (reason: unknown) => void): () => void;
  onShutdownSignal(handler: () => void): () => void;
  exit(code: number): void;

  // Environment
  getEnv(key: string): string | undefined;

  hasAsyncLocalStorage(): boolean;

  // Async context (AsyncLocalStorage abstraction)
  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T>;

  // Timers (Web API compatible)
  setTimeout: PlatformSetTimeout;
  clearTimeout: PlatformClearTimeout;

  init: () => Promise<void>;
}

export interface IAsyncLocalStorage<T> {
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
}

type WorkerAwareGlobal = typeof globalThis & {
  importScripts?: (...urls: string[]) => void;
  WorkerGlobalScope?: new () => unknown;
};

/**
 * Backward-compatible utility functions retained for consumers
 * importing environment guards from `platform/types`.
 */
export function isNode(): boolean {
  return !!(
    typeof process !== "undefined" &&
    process.versions &&
    process.versions.node
  );
}

export function isBrowser(): boolean {
  return !!(typeof window !== "undefined" && typeof document !== "undefined");
}

/**
 * Legacy alias kept for compatibility.
 * Worker-like runtimes are now modeled under the "edge" platform id.
 */
export function isWebWorker(): boolean {
  const workerGlobal = globalThis as WorkerAwareGlobal;
  return !!(
    typeof self !== "undefined" &&
    typeof workerGlobal.importScripts === "function" &&
    typeof window === "undefined"
  );
}

export function isEdge(): boolean {
  if (isWebWorker()) return true;
  const workerGlobal = globalThis as WorkerAwareGlobal;
  const workerCtor = workerGlobal.WorkerGlobalScope;
  return !!(
    typeof workerCtor !== "undefined" &&
    typeof self !== "undefined" &&
    self instanceof workerCtor
  );
}

export function isUniversal(): boolean {
  return !isNode() && !isBrowser() && !isEdge();
}
