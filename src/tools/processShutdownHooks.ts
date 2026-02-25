import { getPlatform } from "../platform";
import { normalizeError } from "../globals/resources/tunnel/error-utils";

const platform = getPlatform();

type ShutdownDrainTarget = {
  waitForDrain(timeoutMs: number): Promise<boolean>;
};

function trackAsyncDispatch(
  registry: Set<Promise<void>>,
  dispatch: Promise<unknown>,
): void {
  const trackedDispatch = Promise.allSettled([dispatch]).then(() => undefined);
  registry.add(trackedDispatch);
  void trackedDispatch.finally(() => {
    registry.delete(trackedDispatch);
  });
}

// Global registry of active error handlers for process-level safety nets
const activeErrorHandlers = new Set<
  (
    error: unknown,
    source: "uncaughtException" | "unhandledRejection",
  ) => void | Promise<void>
>();
const inFlightSafetyNetDispatches = new Set<Promise<void>>();
let processSafetyNetsInstalled = false;
let unhookUncaughtException: (() => void) | undefined;
let unhookUnhandledRejection: (() => void) | undefined;

function installGlobalProcessSafetyNetsOnce() {
  if (processSafetyNetsInstalled) return;
  processSafetyNetsInstalled = true;
  const dispatchUncaughtException = async (err: unknown) => {
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
  const dispatchUnhandledRejection = async (reason: unknown) => {
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
  const onUncaughtException = (err: unknown) => {
    trackAsyncDispatch(
      inFlightSafetyNetDispatches,
      dispatchUncaughtException(err),
    );
  };
  const onUnhandledRejection = (reason: unknown) => {
    trackAsyncDispatch(
      inFlightSafetyNetDispatches,
      dispatchUnhandledRejection(reason),
    );
  };
  unhookUncaughtException = platform.onUncaughtException(onUncaughtException);
  unhookUnhandledRejection =
    platform.onUnhandledRejection(onUnhandledRejection);
}

function uninstallGlobalProcessSafetyNetsIfUnused() {
  if (activeErrorHandlers.size > 0 || !processSafetyNetsInstalled) {
    return;
  }

  unhookUncaughtException?.();
  unhookUnhandledRejection?.();
  unhookUncaughtException = undefined;
  unhookUnhandledRejection = undefined;
  processSafetyNetsInstalled = false;
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
    uninstallGlobalProcessSafetyNetsIfUnused();
  };
}

// Global shutdown registry: one listener per signal, dispatching to active disposers
const activeDisposers = new Set<() => Promise<void>>();
const inFlightShutdownDispatches = new Set<Promise<void>>();
let shutdownHooksInstalled = false;
let unhookShutdownSignals: (() => void) | undefined;

function installGlobalShutdownHooksOnce() {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  const dispatchShutdown = async () => {
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
      uninstallGlobalShutdownHooksIfUnused();
      const exitCode = disposalErrors.length === 0 ? 0 : 1;
      try {
        platform.exit(exitCode);
      } catch {
        // Jest guards process.exit by throwing. Ignore to keep tests deterministic.
      }
    }
  };
  const handler = () => {
    trackAsyncDispatch(inFlightShutdownDispatches, dispatchShutdown());
  };
  unhookShutdownSignals = platform.onShutdownSignal(handler);
}

function uninstallGlobalShutdownHooksIfUnused() {
  if (activeDisposers.size > 0 || !shutdownHooksInstalled) {
    return;
  }

  unhookShutdownSignals?.();
  unhookShutdownSignals = undefined;
  shutdownHooksInstalled = false;
}

export function registerShutdownHook(disposeOnce: () => Promise<void>) {
  installGlobalShutdownHooksOnce();
  activeDisposers.add(disposeOnce);
  return () => {
    activeDisposers.delete(disposeOnce);
    uninstallGlobalShutdownHooksIfUnused();
  };
}

export async function waitForDisposeDrainBudget(
  target: ShutdownDrainTarget,
  disposeDrainBudgetMs: number,
): Promise<boolean> {
  return target.waitForDrain(disposeDrainBudgetMs);
}

export async function __waitForProcessHooksIdleForTests(): Promise<void> {
  if (
    inFlightSafetyNetDispatches.size === 0 &&
    inFlightShutdownDispatches.size === 0
  ) {
    return;
  }

  await Promise.all([
    ...Array.from(inFlightSafetyNetDispatches),
    ...Array.from(inFlightShutdownDispatches),
  ]);
}

export function __resetProcessHooksForTests(): void {
  activeErrorHandlers.clear();
  activeDisposers.clear();
  inFlightSafetyNetDispatches.clear();
  inFlightShutdownDispatches.clear();

  unhookUncaughtException?.();
  unhookUnhandledRejection?.();
  unhookShutdownSignals?.();

  unhookUncaughtException = undefined;
  unhookUnhandledRejection = undefined;
  unhookShutdownSignals = undefined;
  processSafetyNetsInstalled = false;
  shutdownHooksInstalled = false;
}
