import { defineFrameworkEvent } from "../definers/frameworkDefinition";
import { IEvent } from "../defs";

const readyEvent = defineFrameworkEvent({
  id: "system.events.ready",
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
   * Emitted when runtime enters the `disposing` phase.
   */
  disposing: defineFrameworkEvent({
    id: "system.events.disposing",
    meta: {
      title: "System Disposing",
      description:
        "Emitted when runtime enters disposing and starts draining in-flight work.",
    },
  }),
  /**
   * Emitted when runtime.dispose() has entered shutdown lockdown
   * and right before resource-level `.dispose()` hooks execute.
   */
  drained: defineFrameworkEvent({
    id: "system.events.drained",
    meta: {
      title: "System Drained",
      description:
        "Emitted after shutdown lockdown and right before resource disposal begins.",
    },
  }),
} as const;

export const globalEventsArray: IEvent<any>[] = [
  globalEvents.ready,
  globalEvents.disposing,
  globalEvents.drained,
];
