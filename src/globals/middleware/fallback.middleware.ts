import { defineTaskMiddleware, isTask } from "../../define";
import { globalResources } from "../globalResources";

export interface FallbackMiddlewareConfig {
  /**
   * The fallback to use if the task fails.
   * Can be a value, a function that returns a value (or promise), or another task.
   */
  fallback: any;
}

/**
 * Fallback middleware: provides a backup value or execution if the main task fails.
 */
export const fallbackTaskMiddleware = defineTaskMiddleware({
  id: "globals.middleware.fallback",
  dependencies: {
    taskRunner: globalResources.taskRunner,
  },
  async run({ task, next }, { taskRunner }, config: FallbackMiddlewareConfig) {
    try {
      return await next(task.input);
    } catch (error) {
      const { fallback } = config;

      if (isTask(fallback)) {
        // If it's a task, run it with the same input using the taskRunner
        return await taskRunner.run(fallback, task.input);
      }

      if (typeof fallback === "function") {
        // If it's a function, call it with the error and task input
        return await fallback(error, task.input);
      }

      // Otherwise, return the fallback value directly
      return fallback;
    }
  },
});
