import { isTask } from "../../define";
import { taskMiddlewareBuilder } from "../../definers/builders/middleware";
import type { ITask } from "../../defs";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { globalResources } from "../globalResources";
import { runtimeSource } from "../../types/runtimeSource";
import { Match } from "../../tools/check";

type FallbackTask = ITask;
type FallbackResolver = {
  bivarianceHack(error: unknown, input: unknown): unknown | Promise<unknown>;
}["bivarianceHack"];
type FallbackValue =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | null
  | Record<string, unknown>
  | Array<unknown>;

export interface FallbackMiddlewareConfig {
  /**
   * The fallback to use if the task fails.
   * Can be a value, a function that returns a value (or promise), or another task.
   */
  fallback: FallbackTask | FallbackResolver | FallbackValue;
}

const fallbackConfigPattern = Match.ObjectIncluding({
  fallback: Match.Any,
});

/**
 * Fallback middleware: provides a backup value or execution if the main task fails.
 */
export const fallbackTaskMiddleware = taskMiddlewareBuilder("fallback")
  .journal({
    /** Whether the fallback path was taken (true) or primary succeeded (false). */
    active: journalHelper.createKey<boolean>("active"),
    /** The error that triggered the fallback, when the fallback path runs. */
    error: journalHelper.createKey<Error>("error"),
  })
  .meta({
    title: "Fallback",
    description:
      "Returns a fallback value, resolver result, or backup task result when the wrapped task fails.",
  })
  .configSchema(fallbackConfigPattern)
  .dependencies({
    taskRunner: globalResources.taskRunner,
  })
  .run(
    async (
      { task, next, journal },
      { taskRunner },
      config: FallbackMiddlewareConfig,
    ) => {
      // Set default: fallback not active
      journal.set(fallbackTaskMiddleware.journalKeys.active, false, {
        override: true,
      });

      try {
        return await next(task.input);
      } catch (error) {
        const { fallback } = config;

        // Mark fallback as active and record the error
        journal.set(fallbackTaskMiddleware.journalKeys.active, true, {
          override: true,
        });
        journal.set(fallbackTaskMiddleware.journalKeys.error, error as Error, {
          override: true,
        });

        if (isTask(fallback)) {
          // If it's a task, run it with the same input using the taskRunner
          return await taskRunner.run(fallback, task.input, {
            source: runtimeSource.taskMiddleware("fallback"),
          });
        }

        if (typeof fallback === "function") {
          // If it's a function, call it with the error and task input
          return await fallback(error, task.input);
        }

        // Otherwise, return the fallback value directly
        return fallback;
      }
    },
  )
  .build();
