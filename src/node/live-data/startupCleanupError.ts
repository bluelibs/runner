import { validationError } from "../../errors";

export function throwStartupCleanupError(
  taskId: string,
  startupError: unknown,
  cleanupError: unknown,
): never {
  return validationError.throw({
    subject: "Live data subscription",
    id: taskId,
    originalError: new LiveDataStartupCleanupError(startupError, cleanupError),
  });
}

class LiveDataStartupCleanupError extends Error {
  readonly errors: readonly unknown[];

  constructor(startupError: unknown, cleanupError: unknown) {
    super("Live-data startup and cleanup both failed.");
    this.name = "LiveDataStartupCleanupError";
    this.errors = [startupError, cleanupError];
  }
}
