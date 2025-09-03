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
  process.on("uncaughtException", onUncaughtException as any);
  process.on("unhandledRejection", onUnhandledRejection as any);
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
  const handler = async (signal: NodeJS.Signals) => {
    try {
      const disposers = Array.from(activeDisposers);
      for (const d of disposers) {
        try {
          await d();
        } catch {}
        activeDisposers.delete(d);
      }
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}

export function registerShutdownHook(disposeOnce: () => Promise<void>) {
  installGlobalShutdownHooksOnce();
  activeDisposers.add(disposeOnce);
  return () => {
    activeDisposers.delete(disposeOnce);
  };
}
