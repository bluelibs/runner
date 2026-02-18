import { defineTaskMiddleware, isTask } from "../../define";
import type { ITask } from "../../defs";
import { journal as journalHelper } from "../../models/ExecutionJournal";
import { globalResources } from "../globalResources";

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
  | undefined
  | Record<string, unknown>
  | Array<unknown>;

export interface FallbackMiddlewareConfig {
  /**
   * The fallback to use if the task fails.
   * Can be a value, a function that returns a value (or promise), or another task.
   */
  fallback: FallbackTask | FallbackResolver | FallbackValue;
}

/**
 * Journal keys exposed by the fallback middleware.
 * Use these to access shared state from downstream middleware or tasks.
 */
export const journalKeys = {
  /** Whether the fallback path was taken (true) or primary succeeded (false) */
  active: journalHelper.createKey<boolean>(
    "globals.middleware.task.fallback.active",
  ),
  /** The error that triggered the fallback (only set when active is true) */
  error: journalHelper.createKey<Error>(
    "globals.middleware.task.fallback.error",
  ),
} as const;

/**
 * Fallback middleware: provides a backup value or execution if the main task fails.
 */
export const fallbackTaskMiddleware = defineTaskMiddleware({
  id: "globals.middleware.task.fallback",
  dependencies: {
    taskRunner: globalResources.taskRunner,
  },
  async run(
    { task, next, journal },
    { taskRunner },
    config: FallbackMiddlewareConfig,
  ) {
    // Set default: fallback not active
    journal.set(journalKeys.active, false, { override: true });

    try {
      return await next(task.input);
    } catch (error) {
      const { fallback } = config;

      // Mark fallback as active and record the error
      journal.set(journalKeys.active, true, { override: true });
      journal.set(journalKeys.error, error as Error, { override: true });

      if (isTask(fallback)) {
        // If it's a task, run it with the same input using the taskRunner
        return await taskRunner.run(fallback, task.input);
      }

      if (typeof fallback === "function") {
        // If it's a function, call it with the error and task input
        return await (fallback as FallbackResolver)(error, task.input);
      }

      // Otherwise, return the fallback value directly
      return fallback;
    }
  },
});
