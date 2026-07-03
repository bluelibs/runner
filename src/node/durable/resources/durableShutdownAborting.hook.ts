import { defineHook } from "../../../definers/defineHook";
import { globalEvents } from "../../../globals/globalEvents";
import { resources } from "../../../public";
import { runtimeShutdownAbortReason } from "../../../tools/runtimeShutdownAbortReason";
import { durableRuntimeTag } from "../tags/durableRuntime.tag";

export const durableShutdownAbortingHook = defineHook({
  id: "onDurableRuntimeAborting",
  on: globalEvents.aborting,
  dependencies: {
    durableRuntimes: durableRuntimeTag,
    logger: resources.logger,
  },
  run: async (_event, { durableRuntimes, logger }) => {
    for (const resource of durableRuntimes.resources) {
      // just in case the resource was lazy
      if (!resource.value) {
        continue;
      }

      try {
        resource.value.service.interruptActiveAttempts(
          runtimeShutdownAbortReason,
        );
      } catch (error) {
        try {
          await logger.warn(
            "Durable shutdown interruption failed for one runtime; continuing abort fan-out.",
            {
              source: "durable.shutdown",
              data: { resourceId: resource.definition.id },
              error,
            },
          );
        } catch {
          // Logging must never stop the remaining runtimes from being interrupted.
        }
      }
    }
  },
  meta: {
    title: "Durable Shutdown Interruption",
    description:
      "Interrupts local in-flight durable workflow attempts when Runner enters the shutdown abort window.",
  },
});
