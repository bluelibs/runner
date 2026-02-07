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

export { detectEnvironment };

export function getPlatform(): IPlatformAdapter {
  if (!platformInstance) {
    platformInstance = createPlatformAdapter();
    detectedEnvironment = platformInstance.id;
  }
  return platformInstance;
}

export function setPlatform(adapter: IPlatformAdapter): void {
  platformInstance = adapter;
  detectedEnvironment = adapter.id;
}

export function resetPlatform(): void {
  platformInstance = null;
  detectedEnvironment = null;
}

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

export function isNode(): boolean {
  if (typeof __TARGET__ !== "undefined" && __TARGET__ !== "universal") {
    return __TARGET__ === "node";
  }
  // Use fresh runtime detection to allow tests to mutate globals within a single run
  return detectEnvironment() === "node";
}

export function isBrowser(): boolean {
  if (typeof __TARGET__ !== "undefined" && __TARGET__ !== "universal") {
    return __TARGET__ === "browser";
  }
  // Use fresh runtime detection to allow tests to mutate globals within a single run
  return detectEnvironment() === "browser";
}

export function isUniversal(): boolean {
  if (typeof __TARGET__ !== "undefined" && __TARGET__ !== "universal") {
    return __TARGET__ === "universal";
  }
  // Use fresh runtime detection to allow tests to mutate globals within a single run
  return detectEnvironment() === "universal";
}

export type {
  IPlatformAdapter,
  IAsyncLocalStorage,
  PlatformId,
  PlatformSetTimeout,
  PlatformClearTimeout,
} from "./types";

// Backwards-compat adapter preserving old constructor(env) signature used in tests
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
  onUncaughtException(handler: (error: any) => void) {
    return this.inner.onUncaughtException(handler);
  }
  onUnhandledRejection(handler: (reason: any) => void) {
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
