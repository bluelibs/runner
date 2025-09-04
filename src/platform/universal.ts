/**
 * Universal Platform Adapter
 * Works in browsers, web workers, edge runtimes, and other non-Node.js environments
 * Uses Web APIs and polyfills where necessary
 */
import type { IPlatformAdapter, IAsyncLocalStorage } from "./types";
import { PlatformUnsupportedFunction } from "../errors";

export class UniversalPlatformAdapter implements IPlatformAdapter {
  onUncaughtException(handler: (error: any) => void): () => void {
    const listener = (event: any) => handler(event.error);
    (globalThis as any).addEventListener?.("error", listener);
    return () => (globalThis as any).removeEventListener?.("error", listener);
  }

  onUnhandledRejection(handler: (reason: any) => void): () => void {
    const listener = (event: any) => handler(event.reason);
    (globalThis as any).addEventListener?.("unhandledrejection", listener);
    return () =>
      (globalThis as any).removeEventListener?.("unhandledrejection", listener);
  }

  onShutdownSignal(handler: () => void): () => void {
    // Browser equivalent - beforeunload for graceful cleanup
    const listener = () => handler();
    (globalThis as any).addEventListener?.("beforeunload", listener);

    // Also listen for visibilitychange as a secondary signal
    const visibilityListener = () => {
      const doc = (globalThis as any).document;
      if (doc?.visibilityState === "hidden") {
        handler();
      }
    };
    (globalThis as any).addEventListener?.(
      "visibilitychange",
      visibilityListener,
    );

    return () => {
      (globalThis as any).removeEventListener?.("beforeunload", listener);
      (globalThis as any).removeEventListener?.(
        "visibilitychange",
        visibilityListener,
      );
    };
  }

  exit(code: number): void {
    // Not supported in universal environments (browser/edge workers)
    throw new PlatformUnsupportedFunction(`exit(${code})`);
  }

  getEnv(key: string): string | undefined {
    // Try various environment sources in order of preference
    return (
      // Vite/build tool injected env
      (globalThis as any).__ENV__?.[key] ||
      // Node.js-like process.env (if available)
      (globalThis as any).process?.env?.[key] ||
      // Browser build-time env (if injected by bundler)
      (globalThis as any).env?.[key] ||
      undefined
    );
  }

  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T> {
    throw new PlatformUnsupportedFunction("createAsyncLocalStorage");
  }

  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
}
