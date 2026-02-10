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

function installGlobalProcessSafetyNetsOnce() {
  if (processSafetyNetsInstalled) return;
  processSafetyNetsInstalled = true;
  const onUncaughtException = async (err: any) => {
    for (const handler of activeErrorHandlers) {
      try {
        await handler(err, "uncaughtException");
      } catch (_) {}
    }
  };
  const onUnhandledRejection = async (reason: any) => {
    for (const handler of activeErrorHandlers) {
      try {
        await handler(reason, "unhandledRejection");
      } catch (_) {}
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
    try {
      const disposers = Array.from(activeDisposers);
      for (const d of disposers) {
        try {
          await d();
        } catch {}
        activeDisposers.delete(d);
      }
    } finally {
      platform.exit(0);
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
