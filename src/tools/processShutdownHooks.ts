import { getPlatform } from "../platform";
import { normalizeError } from "../globals/resources/tunnel/error-utils";

const platform = getPlatform();

// Global registry of active error handlers for process-level safety nets
const activeErrorHandlers = new Set<
  (
    error: unknown,
    source: "uncaughtException" | "unhandledRejection",
  ) => void | Promise<void>
>();
let processSafetyNetsInstalled = false;

function installGlobalProcessSafetyNetsOnce() {
  if (processSafetyNetsInstalled) return;
  processSafetyNetsInstalled = true;
  const onUncaughtException = async (err: unknown) => {
    for (const handler of activeErrorHandlers) {
      try {
        await handler(err, "uncaughtException");
      } catch (handlerError) {
        console.error("[runner] Process error handler failed.", {
          source: "uncaughtException",
          originalError: normalizeError(err),
          handlerError: normalizeError(handlerError),
        });
      }
    }
  };
  const onUnhandledRejection = async (reason: unknown) => {
    for (const handler of activeErrorHandlers) {
      try {
        await handler(reason, "unhandledRejection");
      } catch (handlerError) {
        console.error("[runner] Process error handler failed.", {
          source: "unhandledRejection",
          originalError: normalizeError(reason),
          handlerError: normalizeError(handlerError),
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
          const normalizedError = normalizeError(disposeError);
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
