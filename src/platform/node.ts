/**
 * Node.js Platform Adapter
 * Uses Node.js-specific APIs for process management and async context
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { IPlatformAdapter, IAsyncLocalStorage } from "./types";

export class NodePlatformAdapter implements IPlatformAdapter {
  onUncaughtException(handler: (error: any) => void): () => void {
    process.on("uncaughtException", handler);
    return () => process.off("uncaughtException", handler);
  }

  onUnhandledRejection(handler: (reason: any) => void): () => void {
    process.on("unhandledRejection", handler);
    return () => process.off("unhandledRejection", handler);
  }

  onShutdownSignal(handler: () => void): () => void {
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
    return () => {
      process.off("SIGINT", handler);
      process.off("SIGTERM", handler);
    };
  }

  exit(code: number): void {
    process.exit(code);
  }

  getEnv(key: string): string | undefined {
    return process.env[key];
  }

  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T> {
    const als = new AsyncLocalStorage<T>();
    return {
      getStore: () => als.getStore(),
      run: (store, callback) => als.run(store, callback),
    };
  }

  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
}
