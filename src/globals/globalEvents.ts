import { defineEvent } from "../definers/defineEvent";
import { markFrameworkDefinition } from "../definers/markFrameworkDefinition";
import { IEvent } from "../defs";

const readyEvent = defineEvent(
  markFrameworkDefinition({
    id: "system.events.ready",
    meta: {
      title: "System Ready",
      description:
        "Emitted when the system has completed boot and is ready for listeners to start work." +
        " This runs right before returning value for run().",
    },
  }),
);

export const globalEvents = {
  /**
   * Emitted when the system is fully initialized and ready for work.
   */
  ready: readyEvent,
  /**
   * Emitted after `coolingDown` completes and runtime enters the `disposing` phase.
   */
  disposing: defineEvent(
    markFrameworkDefinition({
      id: "system.events.disposing",
      meta: {
        title: "System Disposing",
        description:
          "Emitted after cooldown completes, when runtime locks new business admissions and starts draining in-flight work.",
      },
    }),
  ),
  /**
   * Emitted when runtime.dispose() has entered shutdown lockdown
   * and right before resource-level `.dispose()` hooks execute.
   */
  drained: defineEvent(
    markFrameworkDefinition({
      id: "system.events.drained",
      meta: {
        title: "System Drained",
        description:
          "Emitted after shutdown lockdown and right before resource disposal begins.",
      },
    }),
  ),
} as const;

/**
 * Ordered list form of {@link globalEvents}, used when framework internals need iteration.
 */
export const globalEventsArray: IEvent<any>[] = [
  globalEvents.ready,
  globalEvents.disposing,
  globalEvents.drained,
];
