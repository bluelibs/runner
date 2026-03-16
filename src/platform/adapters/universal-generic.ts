import type { IAsyncLocalStorage, IPlatformAdapter } from "../types";
import { platformUnsupportedFunctionError } from "../../errors";
import { normalizeError } from "../../tools/normalizeError";
import {
  getBuiltinAsyncLocalStorageClass,
  loadAsyncLocalStorageClass,
} from "./node-als";
import { readEnvironmentVariable } from "./env";

interface GenericEventTarget extends Record<string, unknown> {
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener?: (
    type: string,
    listener: (event: unknown) => void,
  ) => void;
  document?: { visibilityState?: unknown };
  AsyncLocalStorage?: new <T>() => IAsyncLocalStorage<T>;
}

// A generic, non-detecting adapter that uses globalThis listeners and no Node APIs.
export class GenericUniversalPlatformAdapter implements IPlatformAdapter {
  readonly id = "universal" as const;
  private alsClass: (new <T>() => IAsyncLocalStorage<T>) | null | undefined =
    null;
  private alsProbed = false;

  async init() {
    await this.probeAsyncLocalStorage();
  }

  private async probeAsyncLocalStorage(): Promise<void> {
    if (this.alsProbed) return;
    this.alsProbed = true;

    const g = globalThis as GenericEventTarget;

    if (typeof g.AsyncLocalStorage === "function") {
      this.alsClass = g.AsyncLocalStorage as new <T>() => IAsyncLocalStorage<T>;
      return;
    }

    try {
      // Some universal runtimes expose Node compatibility modules without
      // exposing a global AsyncLocalStorage constructor.
      this.alsClass =
        getBuiltinAsyncLocalStorageClass() ??
        ((await loadAsyncLocalStorageClass()) as new <
          T,
        >() => IAsyncLocalStorage<T>);
    } catch {
      // Unsupported in this runtime; fallback remains unsupported.
    }
  }

  onUncaughtException(handler: (error: unknown) => void) {
    const tgt = globalThis as GenericEventTarget;
    if (tgt.addEventListener) {
      const h = (event: unknown) => {
        const error =
          event &&
          typeof event === "object" &&
          "error" in event &&
          (event as { error?: unknown }).error !== undefined
            ? (event as { error?: unknown }).error
            : event;
        handler(normalizeError(error));
      };
      tgt.addEventListener("error", h);
      return () => tgt.removeEventListener?.("error", h);
    }
    return () => {};
  }

  onUnhandledRejection(handler: (reason: unknown) => void) {
    const tgt = globalThis as GenericEventTarget;
    if (tgt.addEventListener) {
      const wrap = (event: unknown) => {
        const reason =
          event &&
          typeof event === "object" &&
          "reason" in event &&
          (event as { reason?: unknown }).reason !== undefined
            ? (event as { reason?: unknown }).reason
            : event;
        handler(reason);
      };
      tgt.addEventListener("unhandledrejection", wrap);
      return () => tgt.removeEventListener?.("unhandledrejection", wrap);
    }
    return () => {};
  }

  onShutdownSignal(handler: () => void) {
    const tgt = globalThis as GenericEventTarget;
    if (tgt.addEventListener) {
      const handlers: {
        before?: () => void;
        visibility?: () => void;
      } = {};
      handlers.before = () => handler();
      tgt.addEventListener("beforeunload", handlers.before);

      const doc = tgt.document;
      if (doc) {
        handlers.visibility = () => {
          if (doc.visibilityState === "hidden") handler();
        };
        tgt.addEventListener?.("visibilitychange", handlers.visibility);
      }

      return () => {
        tgt.removeEventListener?.(
          "beforeunload",
          handlers.before as (event: unknown) => void,
        );
        if (handlers.visibility)
          tgt.removeEventListener?.("visibilitychange", handlers.visibility);
      };
    }
    return () => {};
  }

  exit(): void {
    platformUnsupportedFunctionError.throw({ functionName: "exit" });
  }

  getEnv(key: string): string | undefined {
    return readEnvironmentVariable(key);
  }

  hasAsyncLocalStorage(): boolean {
    if (!this.alsProbed) {
      const g = globalThis as GenericEventTarget;
      if (typeof g.AsyncLocalStorage === "function") {
        this.alsClass = g.AsyncLocalStorage as new <
          T,
        >() => IAsyncLocalStorage<T>;
        this.alsProbed = true;
      } else {
        try {
          this.alsClass = getBuiltinAsyncLocalStorageClass() ?? null;
        } catch {
          this.alsClass = null;
        }
        this.alsProbed = true;
      }
    }

    return typeof this.alsClass === "function";
  }

  createAsyncLocalStorage<T>(): IAsyncLocalStorage<T> {
    this.hasAsyncLocalStorage();
    if (this.alsClass) {
      return new this.alsClass<T>();
    }

    // Construct without throw; error only when used
    return {
      getStore: (): T | undefined => {
        return platformUnsupportedFunctionError.throw({
          functionName: "createAsyncLocalStorage",
        });
      },
      run: <R>(_store: T, _callback: () => R): R => {
        return platformUnsupportedFunctionError.throw({
          functionName: "createAsyncLocalStorage",
        });
      },
    };
  }

  setTimeout = globalThis.setTimeout;
  clearTimeout = globalThis.clearTimeout;
}
