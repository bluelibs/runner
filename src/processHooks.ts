import { EventManager } from "./models/EventManager";
import { globalEvents } from "./globals/globalEvents";

// Global registry of active EventManagers for process-level safety nets
const activeEventManagers = new Set<EventManager>();
let processSafetyNetsInstalled = false;

function installGlobalProcessSafetyNetsOnce() {
  if (processSafetyNetsInstalled) return;
  processSafetyNetsInstalled = true;
  const onUncaughtException = async (err: any) => {
    for (const em of activeEventManagers) {
      try {
        await em.emit(
          globalEvents.unhandledError,
          { kind: "process", error: err, source: "uncaughtException" },
          "process"
        );
      } catch (_) {}
    }
  };
  const onUnhandledRejection = async (reason: any) => {
    for (const em of activeEventManagers) {
      try {
        await em.emit(
          globalEvents.unhandledError,
          { kind: "process", error: reason, source: "unhandledRejection" },
          "process"
        );
      } catch (_) {}
    }
  };
  process.on("uncaughtException", onUncaughtException as any);
  process.on("unhandledRejection", onUnhandledRejection as any);
}

export function registerProcessLevelSafetyNets(eventManager: EventManager) {
  installGlobalProcessSafetyNetsOnce();
  activeEventManagers.add(eventManager);
  return () => {
    activeEventManagers.delete(eventManager);
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
