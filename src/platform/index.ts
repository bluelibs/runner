import type { IPlatformAdapter, IAsyncLocalStorage } from "./types";
import { createPlatformAdapter } from "./factory";
import { detectEnvironment, type PlatformEnv } from "./adapters/universal";
import { NodePlatformAdapter } from "./adapters/node";
import { BrowserPlatformAdapter } from "./adapters/browser";
import { EdgePlatformAdapter } from "./adapters/edge";
import { UniversalPlatformAdapter } from "./adapters/universal";
import { GenericUniversalPlatformAdapter } from "./adapters/universal-generic";

// Keep legacy names but delegate to new adapters
let platformInstance: IPlatformAdapter | null = null;
let detectedEnvironment: PlatformEnv | null = null;

export { detectEnvironment };

export function getPlatform(): IPlatformAdapter {
  if (!platformInstance) {
    platformInstance = createPlatformAdapter();
    detectedEnvironment = detectEnvironment();
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

export type { IPlatformAdapter, IAsyncLocalStorage } from "./types";

// Backwards-compat adapter preserving old constructor(env) signature used in tests
export class PlatformAdapter implements IPlatformAdapter {
  private inner: IPlatformAdapter;
  readonly env: PlatformEnv;

  constructor(env?: PlatformEnv) {
    const kind = env ?? detectEnvironment();
    this.env = kind as PlatformEnv;
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
  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
}
