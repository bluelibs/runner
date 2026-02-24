import { defineEvent } from "../define";
import { IEvent } from "../defs";

const readyEvent = defineEvent({
  id: "globals.events.ready",
  meta: {
    title: "System Ready",
    description:
      "Emitted when the system has completed boot and is ready for listeners to start work." +
      " This runs right before returning value for run().",
  },
});

export const globalEvents = {
  /**
   * Emitted when the system is fully initialized and ready for work.
   */
  ready: readyEvent,
  /**
   * Emitted when runtime.dispose() starts, before shutdown lockdown and draining begin.
   */
  disposing: defineEvent({
    id: "globals.events.disposing",
    meta: {
      title: "System Disposing",
      description:
        "Emitted when runtime.dispose() begins teardown, before shutdown lockdown" +
        " and in-flight drain.",
    },
  }),
  /**
   * Emitted when runtime.dispose() finishes draining in-flight task/event work,
   * right before resource-level `.dispose()` hooks execute.
   */
  drained: defineEvent({
    id: "globals.events.drained",
    meta: {
      title: "System Drained",
      description:
        "Emitted after shutdown lockdown has drained in-flight task/event work and" +
        " right before resource disposal begins.",
    },
  }),
  /**
   * Emitted when process shutdown hooks (SIGINT/SIGTERM) begin teardown.
   * This is not emitted by manual runtime.dispose().
   */
  shutdown: defineEvent({
    id: "globals.events.shutdown",
    meta: {
      title: "System Shutdown",
      description:
        "Emitted when shutdown hooks react to a process shutdown signal and start teardown.",
    },
  }),
} as const;

export const globalEventsArray: IEvent<any>[] = [
  globalEvents.ready,
  globalEvents.disposing,
  globalEvents.drained,
  globalEvents.shutdown,
];
