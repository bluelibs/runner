import type {
  IPlatformAdapter,
  IAsyncLocalStorage,
  PlatformId,
  PlatformSetTimeout,
  PlatformClearTimeout,
} from "./types";
import { createPlatformAdapter } from "./factory";
import { detectEnvironment } from "./adapters/universal";
import { NodePlatformAdapter } from "./adapters/node";
import { BrowserPlatformAdapter } from "./adapters/browser";
import { EdgePlatformAdapter } from "./adapters/edge";
import { UniversalPlatformAdapter } from "./adapters/universal";
import { GenericUniversalPlatformAdapter } from "./adapters/universal-generic";

declare const __TARGET__: string | undefined;

// Keep legacy names but delegate to new adapters
let platformInstance: IPlatformAdapter | null = null;
let detectedEnvironment: PlatformId | null = null;

/**
 * Detects the current runtime environment without instantiating the active adapter.
 */
export { detectEnvironment };

/**
 * Returns the active platform adapter, creating it lazily on first access.
 */
export function getPlatform(): IPlatformAdapter {
  if (!platformInstance) {
    platformInstance = createPlatformAdapter();
    detectedEnvironment = platformInstance.id;
  }
  return platformInstance;
}

/**
 * Overrides the active platform adapter.
 *
 * This is mainly useful for tests or advanced hosts that need custom runtime hooks.
 */
export function setPlatform(adapter: IPlatformAdapter): void {
  platformInstance = adapter;
  detectedEnvironment = adapter.id;
}

/**
 * Clears the cached platform adapter so environment detection can run again.
 */
export function resetPlatform(): void {
  platformInstance = null;
  detectedEnvironment = null;
}

/**
 * Returns the detected environment id, preferring the build target when one is baked in.
 */
export function getDetectedEnvironment(): PlatformId {
  if (detectedEnvironment) return detectedEnvironment;
  // Prefer build-time target when available (node/browser/edge bundles)
  if (typeof __TARGET__ !== "undefined" && __TARGET__ !== "universal") {
    detectedEnvironment = __TARGET__ as PlatformId;
    return detectedEnvironment;
  }
  // For undefined or explicit universal target, use runtime detection
  detectedEnvironment = detectEnvironment();
  return detectedEnvironment;
}

/**
 * Reports whether the current runtime should behave like the Node build.
 */
export function isNode(): boolean {
  if (typeof __TARGET__ !== "undefined" && __TARGET__ !== "universal") {
    return __TARGET__ === "node";
  }
  // Use fresh runtime detection to allow tests to mutate globals within a single run
  return detectEnvironment() === "node";
}

/**
 * Reports whether the current runtime should behave like the browser build.
 */
export function isBrowser(): boolean {
  if (typeof __TARGET__ !== "undefined" && __TARGET__ !== "universal") {
    return __TARGET__ === "browser";
  }
  // Use fresh runtime detection to allow tests to mutate globals within a single run
  return detectEnvironment() === "browser";
}

/**
 * Reports whether the current runtime is using the universal fallback behavior.
 */
export function isUniversal(): boolean {
  if (typeof __TARGET__ !== "undefined" && __TARGET__ !== "universal") {
    return __TARGET__ === "universal";
  }
  // Use fresh runtime detection to allow tests to mutate globals within a single run
  return detectEnvironment() === "universal";
}

/**
 * Reports whether the current runtime should behave like the edge build.
 */
export function isEdge(): boolean {
  if (typeof __TARGET__ !== "undefined" && __TARGET__ !== "universal") {
    return __TARGET__ === "edge";
  }
  return detectEnvironment() === "edge";
}

export type {
  IPlatformAdapter,
  IAsyncLocalStorage,
  PlatformId,
  PlatformSetTimeout,
  PlatformClearTimeout,
} from "./types";

// Backwards-compat adapter preserving old constructor(env) signature used in tests
/**
 * Compatibility wrapper around the current platform adapter implementations.
 *
 * Prefer {@link getPlatform} for normal runtime access. This class exists so older
 * integrations and tests can keep using the legacy constructor-based API.
 */
export class PlatformAdapter implements IPlatformAdapter {
  private inner: IPlatformAdapter;
  readonly env: PlatformId;
  readonly id: PlatformId;
  readonly setTimeout: PlatformSetTimeout;
  readonly clearTimeout: PlatformClearTimeout;

  constructor(env?: PlatformId) {
    const kind = env ?? detectEnvironment();
    this.env = kind as PlatformId;
    switch (kind) {
      case "node":
        this.inner = new NodePlatformAdapter();
        break;
      case "browser":
        this.inner = new BrowserPlatformAdapter();
        break;
      case "edge":
        this.inner = new EdgePlatformAdapter();
        break;
      case "universal":
        // Force generic, non-detecting behavior expected by tests
        this.inner = new GenericUniversalPlatformAdapter();
        break;
      default:
        this.inner = new UniversalPlatformAdapter();
    }
    this.id = this.inner.id;
    this.setTimeout = this.inner.setTimeout;
    this.clearTimeout = this.inner.clearTimeout;
  }

  async init() {
    return this.inner.init();
  }
  onUncaughtException(handler: (error: unknown) => void) {
    return this.inner.onUncaughtException(handler);
  }
  onUnhandledRejection(handler: (reason: unknown) => void) {
    return this.inner.onUnhandledRejection(handler);
  }
  onShutdownSignal(handler: () => void) {
    return this.inner.onShutdownSignal(handler);
  }
  exit(code: number) {
    return this.inner.exit(code);
  }
  getEnv(key: string) {
    return this.inner.getEnv(key);
  }
  hasAsyncLocalStorage() {
    return this.inner.hasAsyncLocalStorage();
  }
  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T> {
    return this.inner.createAsyncLocalStorage<T>();
  }
}
