import type { IAsyncLocalStorage } from "../types";
import { BrowserPlatformAdapter } from "./browser";

/**
 * Edge runtimes (workers) are closer to browsers but may support
 * AsyncLocalStorage via the `node:async_hooks` compat layer
 * (e.g. Cloudflare Workers, Vercel Edge).
 */
export class EdgePlatformAdapter extends BrowserPlatformAdapter {
  readonly id = "edge" as const;
  private alsClass: (new <T>() => IAsyncLocalStorage<T>) | null = null;
  private alsProbed = false;

  async init() {
    await this.probeAsyncLocalStorage();
  }

  /**
   * Attempt to discover AsyncLocalStorage from the runtime.
   * Checks globalThis first, then tries `import("node:async_hooks")`.
   */
  private probeGlobalAsyncLocalStorage(): boolean {
    if (this.alsClass) return true;
    const g = globalThis as Record<string, unknown>;
    if (typeof g.AsyncLocalStorage === "function") {
      this.alsClass = g.AsyncLocalStorage as new <T>() => IAsyncLocalStorage<T>;
      return true;
    }
    return false;
  }

  private async probeAsyncLocalStorage(): Promise<void> {
    if (this.alsProbed) return;
    if (this.probeGlobalAsyncLocalStorage()) {
      this.alsProbed = true;
      return;
    }

    try {
      const mod = (await import("node:async_hooks")) as {
        AsyncLocalStorage?: new <T>() => IAsyncLocalStorage<T>;
      };
      if (mod?.AsyncLocalStorage) {
        this.alsClass = mod.AsyncLocalStorage;
      }
    } catch {
      // Not available in this runtime.
    } finally {
      this.alsProbed = true;
    }
  }

  onShutdownSignal(_handler: () => void) {
    // No reliable shutdown signal in workers; return no-op disposer
    return () => {};
  }

  hasAsyncLocalStorage(): boolean {
    this.probeGlobalAsyncLocalStorage();
    return this.alsClass !== null;
  }

  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T> {
    this.probeGlobalAsyncLocalStorage();
    if (this.alsClass) {
      return new this.alsClass<T>();
    }
    return super.createAsyncLocalStorage<T>();
  }
}
