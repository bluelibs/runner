/**
 * Platform abstraction interface for universal compatibility
 * Inspired by Remix's approach to Web APIs and runtime-agnostic design
 */

export interface IPlatformAdapter {
  // Process management
  onUncaughtException(handler: (error: Error) => void): () => void;
  onUnhandledRejection(handler: (reason: unknown) => void): () => void;
  onShutdownSignal(handler: () => void): () => void;
  exit(code: number): void;

  // Environment
  getEnv(key: string): string | undefined;

  // Async context (AsyncLocalStorage abstraction)
  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T>;

  // Timers (Web API compatible)
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}

export interface IAsyncLocalStorage<T> {
  getStore(): T | undefined;
  run<R>(store: T, callback: () => R): R;
}

// Browser-specific event types for better type safety
export interface BrowserErrorEvent extends ErrorEvent {
  error: Error;
}

export interface BrowserPromiseRejectionEvent extends PromiseRejectionEvent {
  reason: unknown;
  promise: Promise<unknown>;
}

// Environment detection utilities
export const isBrowser = (): boolean =>
  typeof window !== "undefined" && typeof document !== "undefined";

export const isWebWorker = (): boolean =>
  typeof self !== "undefined" &&
  typeof window === "undefined" &&
  typeof (globalThis as any).importScripts === "function";

export const isNode = (): boolean =>
  typeof process !== "undefined" &&
  process.versions != null &&
  process.versions.node != null;
