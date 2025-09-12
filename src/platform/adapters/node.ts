import type { IAsyncLocalStorage, IPlatformAdapter } from "../types";
import { PlatformUnsupportedFunction } from "../../errors";
import { loadAsyncLocalStorageClass } from "./node-als";

export class NodePlatformAdapter implements IPlatformAdapter {
  readonly id = "node" as const;
  private alsClass: any;

  async init() {
    this.alsClass = await loadAsyncLocalStorageClass();
  }

  onUncaughtException(handler: (error: any) => void) {
    process.on("uncaughtException", handler as any);
    return () => process.off("uncaughtException", handler as any);
  }

  onUnhandledRejection(handler: (reason: any) => void) {
    const h = (reason: any) => handler(reason);
    process.on("unhandledRejection", h);
    return () => process.off("unhandledRejection", h);
  }

  onShutdownSignal(handler: () => void) {
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
    return () => {
      process.off("SIGINT", handler);
      process.off("SIGTERM", handler);
    };
  }

  exit(code: number) {
    process.exit(code);
  }

  getEnv(key: string) {
    return process.env[key];
  }

  hasAsyncLocalStorage() {
    return true;
  }

  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T> {
    let instance: any;
    const ensure = () => {
      if (!this.alsClass) {
        throw new PlatformUnsupportedFunction(
          "createAsyncLocalStorage: Platform not initialized",
        );
      }
      return (instance ??= new this.alsClass());
    };
    return {
      getStore: () => ensure().getStore(),
      run: (store: T, callback: () => any) => ensure().run(store, callback),
    };
  }

  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
}
