/**
 * Platform abstraction interface for universal compatibility
 * Inspired by Remix's approach to Web APIs and runtime-agnostic design
 */

export type PlatformId = "node" | "browser" | "edge" | "universal";

export interface IPlatformAdapter {
  readonly id: PlatformId;
  // Process management
  onUncaughtException(handler: (error: Error) => void): () => void;
  onUnhandledRejection(handler: (reason: unknown) => void): () => void;
  onShutdownSignal(handler: () => void): () => void;
  exit(code: number): void;

  // Environment
  getEnv(key: string): string | undefined;

  hasAsyncLocalStorage(): boolean;

  // Async context (AsyncLocalStorage abstraction)
  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T>;

  // Timers (Web API compatible)
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;

  init: () => Promise<void>;
}

export interface IAsyncLocalStorage<T> {
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
}

/**
 * Utility functions for environment detection
 */
export function isNode(): boolean {
  return !!(
    typeof process !== "undefined" &&
    process.versions &&
    process.versions.node
  );
}

export function isBrowser(): boolean {
  // JSDOM environment in tests may define window/document as objects
  // Treat their presence as browser-like
  return !!(typeof window !== "undefined" && typeof document !== "undefined");
}

export function isWebWorker(): boolean {
  return !!(
    typeof self !== "undefined" &&
    typeof (
      globalThis as unknown as { importScripts: (urls: string[]) => void }
    ).importScripts === "function" &&
    typeof window === "undefined"
  );
}

export function isUniversal(): boolean {
  return !isNode() && !isBrowser() && !isWebWorker();
}
