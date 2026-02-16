import { getPlatform } from "../platform";

const platform = getPlatform();

// Global registry of active error handlers for process-level safety nets
const activeErrorHandlers = new Set<
  (
    error: unknown,
    source: "uncaughtException" | "unhandledRejection",
  ) => void | Promise<void>
>();
let processSafetyNetsInstalled = false;

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function installGlobalProcessSafetyNetsOnce() {
  if (processSafetyNetsInstalled) return;
  processSafetyNetsInstalled = true;
  const onUncaughtException = async (err: any) => {
    for (const handler of activeErrorHandlers) {
      try {
        await handler(err, "uncaughtException");
      } catch (handlerError) {
        console.error("[runner] Process error handler failed.", {
          source: "uncaughtException",
          originalError: toError(err),
          handlerError: toError(handlerError),
        });
      }
    }
  };
  const onUnhandledRejection = async (reason: any) => {
    for (const handler of activeErrorHandlers) {
      try {
        await handler(reason, "unhandledRejection");
      } catch (handlerError) {
        console.error("[runner] Process error handler failed.", {
          source: "unhandledRejection",
          originalError: toError(reason),
          handlerError: toError(handlerError),
        });
      }
    }
  };
  platform.onUncaughtException(onUncaughtException);
  platform.onUnhandledRejection(onUnhandledRejection);
}

export function registerProcessLevelSafetyNets(
  handler: (
    error: unknown,
    source: "uncaughtException" | "unhandledRejection",
  ) => void | Promise<void>,
) {
  installGlobalProcessSafetyNetsOnce();
  activeErrorHandlers.add(handler);
  return () => {
    activeErrorHandlers.delete(handler);
  };
}

// Global shutdown registry: one listener per signal, dispatching to active disposers
const activeDisposers = new Set<() => Promise<void>>();
let shutdownHooksInstalled = false;

function installGlobalShutdownHooksOnce() {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  const handler = async () => {
    const disposalErrors: Error[] = [];
    try {
      const disposers = Array.from(activeDisposers);
      for (const d of disposers) {
        try {
          await d();
        } catch (disposeError) {
          const normalizedError = toError(disposeError);
          disposalErrors.push(normalizedError);
          console.error("[runner] Shutdown disposer failed.", normalizedError);
        } finally {
          activeDisposers.delete(d);
        }
      }
    } finally {
      platform.exit(disposalErrors.length === 0 ? 0 : 1);
    }
  };
  platform.onShutdownSignal(handler);
}

export function registerShutdownHook(disposeOnce: () => Promise<void>) {
  installGlobalShutdownHooksOnce();
  activeDisposers.add(disposeOnce);
  return () => {
    activeDisposers.delete(disposeOnce);
  };
}
