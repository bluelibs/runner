import type { IAsyncLocalStorage, IPlatformAdapter } from "../types";
// no platformUnsupportedFunctionError used here; node has platform support
import { loadAsyncLocalStorageClass } from "./node-als";

export class NodePlatformAdapter implements IPlatformAdapter {
  readonly id = "node" as const;
  private alsClass: (new <T>() => IAsyncLocalStorage<T>) | undefined;

  async init() {
    this.alsClass = (await loadAsyncLocalStorageClass()) as new <
      T,
    >() => IAsyncLocalStorage<T>;
  }

  onUncaughtException(handler: (error: Error) => void) {
    const h = (error: Error) => handler(error);
    process.on("uncaughtException", h);
    return () => process.off("uncaughtException", h);
  }

  onUnhandledRejection(handler: (reason: unknown) => void) {
    const h = (reason: unknown) => handler(reason);
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
    let instance: IAsyncLocalStorage<T> | undefined;
    const ensure = (): IAsyncLocalStorage<T> => {
      if (!this.alsClass) {
        // Lazy-hydrate when init() wasn't awaited.
        let als: (new <U>() => IAsyncLocalStorage<U>) | undefined;
        const forceNoop =
          typeof process !== "undefined" &&
          !!process.env?.RUNNER_FORCE_NOOP_ALS;
        if (!forceNoop) {
          try {
            const mod = require("async_hooks");
            als = mod?.AsyncLocalStorage;
          } catch (_) {
            als = undefined;
          }
        }

        this.alsClass =
          als ||
          (class NoopAsyncLocalStorage<U> implements IAsyncLocalStorage<U> {
            getStore(): U | undefined {
              return undefined;
            }
            run<V>(_store: U, callback: () => V): V {
              return callback();
            }
          } as new <U>() => IAsyncLocalStorage<U>);
      }
      return (instance ??= new this.alsClass!());
    };
    return {
      getStore: () => ensure().getStore(),
      run: (store: T, callback: () => any) => ensure().run(store, callback),
    };
  }

  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
}
