import type { IAsyncLocalStorage, IPlatformAdapter } from "../types";
// no platformUnsupportedFunctionError used here; node has platform support
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
        // Lazy-hydrate when init() wasn't awaited. We avoid static
        // node-only imports for multi-platform builds by using a
        // runtime-only require resolved via eval, so bundlers don't
        // include it for non-node targets.
        let als: any | undefined;
        const forceNoop =
          typeof process !== "undefined" &&
          !!process.env?.RUNNER_FORCE_NOOP_ALS;
        if (!forceNoop) {
          try {
            // In Node test/runtime, require is available and faster;
            // this path is used only in node builds/tests.
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod: any = require("async_hooks");
            als = (mod as any)?.AsyncLocalStorage;
          } catch (_) {
            als = undefined;
          }
        }

        // If we couldn't resolve a real AsyncLocalStorage, provide a minimal, no-op
        // implementation so that early calls don't throw. Full semantics are
        // available after explicit init().
        this.alsClass = als
          ? als
          : (class NoopAsyncLocalStorage<U> {
              getStore(): U | undefined {
                return undefined;
              }
              run<V>(_store: U, callback: () => V): V {
                return callback();
              }
            } as any);
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
