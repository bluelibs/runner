import { error } from "./definers/builders/error";
import type { DefaultErrorType, IErrorHelper } from "./types/error";
import { detectEnvironment } from "./platform";

// Duplicate registration
export const duplicateRegistrationError = error<
  { type: string; id: string } & DefaultErrorType
>("runner.errors.duplicateRegistration")
  .format(
    ({ type, id }) =>
      `${type} "${id.toString()}" already registered. You might have used the same 'id' in two different components or you may have registered the same element twice.`,
  )
  .build();

// Dependency not found
export const dependencyNotFoundError = error<
  { key: string } & DefaultErrorType
>("runner.errors.dependencyNotFound")
  .format(
    ({ key }) =>
      `Dependency ${key.toString()} not found. Did you forget to register it through a resource?`,
  )
  .build();

// Unknown item type
export const unknownItemTypeError = error<{ item: unknown } & DefaultErrorType>(
  "runner.errors.unknownItemType",
)
  .format(
    ({ item }) =>
      `Unknown item type: ${String(
        item,
      )}. Please ensure you are not using different versions of '@bluelibs/runner'`,
  )
  .build();

// Context error
export const contextError = error<{ details?: string } & DefaultErrorType>(
  "runner.errors.context",
)
  .format(({ details }) => details ?? "Context error")
  .build();

// Circular dependencies
export const circularDependenciesError = error<
  { cycles: string[] } & DefaultErrorType
>("runner.errors.circularDependencies")
  .format(({ cycles }) => {
    const cycleDetails = cycles.map((cycle) => `  • ${cycle}`).join("\n");
    const hasMiddleware = cycles.some((cycle) => cycle.includes("middleware"));

    let guidance = "\n\nTo resolve circular dependencies:";
    guidance +=
      "\n  • Consider refactoring to reduce coupling between components";
    guidance += "\n  • Extract shared dependencies into separate resources";

    if (hasMiddleware) {
      guidance +=
        "\n  • For middleware: you can filter out tasks/resources using everywhere(fn)";
      guidance +=
        "\n  • Consider using events for communication instead of direct dependencies";
    }

    return `Circular dependencies detected:\n${cycleDetails}${guidance}`;
  })
  .build();

// Event not found
export const eventNotFoundError = error<{ id: string } & DefaultErrorType>(
  "runner.errors.eventNotFound",
)
  .format(
    ({ id }) =>
      `Event "${id.toString()}" not found. Did you forget to register it?`,
  )
  .build();

// Resource not found
export const resourceNotFoundError = error<{ id: string } & DefaultErrorType>(
  "runner.errors.resourceNotFound",
)
  .format(
    ({ id }) =>
      `Resource "${id.toString()}" not found. Did you forget to register it or are you using the correct id?`,
  )
  .build();

// Middleware not registered
export const middlewareNotRegisteredError = error<
  {
    type: "task" | "resource";
    source: string;
    middlewareId: string;
  } & DefaultErrorType
>("runner.errors.middlewareNotRegistered")
  .format(
    ({ type, source, middlewareId }) =>
      `Middleware inside ${type} "${source}" depends on "${middlewareId}" but it's not registered. Did you forget to register it?`,
  )
  .build();

// Tag not found
export const tagNotFoundError = error<{ id: string } & DefaultErrorType>(
  "runner.errors.tagNotFound",
)
  .format(
    ({ id }) =>
      `Tag "${id}" not registered. Did you forget to register it inside a resource?`,
  )
  .build();

// Locked
export const lockedError = error<{ what: string } & DefaultErrorType>(
  "runner.errors.locked",
)
  .format(
    ({ what }) => `Cannot modify the ${what.toString()} when it is locked.`,
  )
  .build();

// Store already initialized
export const storeAlreadyInitializedError = error<DefaultErrorType>(
  "runner.errors.storeAlreadyInitialized",
)
  .format(() => "Store already initialized. Cannot reinitialize.")
  .build();

// Validation error
export const validationError = error<
  {
    subject: string;
    id: string;
    originalError: string | Error;
  } & DefaultErrorType
>("runner.errors.validation")
  .format(({ subject, id, originalError }) => {
    const errorMessage =
      originalError instanceof Error
        ? originalError.message
        : String(originalError);
    return `${subject} validation failed for ${id.toString()}: ${errorMessage}`;
  })
  .build();

// Event cycle (runtime)
export const eventCycleError = error<
  { path: Array<{ id: string; source: string }> } & DefaultErrorType
>("runner.errors.eventCycle")
  .format(({ path }) => {
    const chain = path.map((p) => `${p.id}←${p.source}`).join("  ->  ");
    return `Event emission cycle detected:\n  ${chain}\n\nBreak the cycle by changing hook logic (avoid mutual emits) or gate with conditions/tags.`;
  })
  .build();

// Event emission cycles (compile-time/dry-run)
export const eventEmissionCycleError = error<
  { cycles: string[] } & DefaultErrorType
>("runner.errors.eventEmissionCycle")
  .format(({ cycles }) => {
    const list = cycles.map((c) => `  • ${c}`).join("\n");
    return `Event emission cycles detected between hooks and events:\n${list}\n\nThis was detected at compile time (dry-run). Break the cycle by avoiding mutual emits between hooks or scoping hooks using tags.`;
  })
  .build();

// Platform unsupported function
export const platformUnsupportedFunctionError = error<
  { functionName: string } & DefaultErrorType
>("runner.errors.platformUnsupportedFunction")
  .format(
    ({ functionName }) =>
      `Platform function not supported in this environment: ${functionName}. Detected platform: ${detectEnvironment()}.`,
  )
  .build();

// Cancellation error (maps to HTTP 499 in exposure)
export const cancellationError = error<{ reason?: string } & DefaultErrorType>(
  "runner.errors.cancellation",
)
  .format(({ reason }) => reason || "Operation cancelled")
  .build();

// Tunnel ownership conflict (exclusive owner per task)
export const tunnelOwnershipConflictError = error<
  {
    taskId: string;
    currentOwnerId: string;
    attemptedOwnerId: string;
  } & DefaultErrorType
>("runner.errors.tunnelOwnershipConflict")
  .format(({ taskId, currentOwnerId, attemptedOwnerId }) =>
    `Task "${taskId}" is already tunneled by resource "${currentOwnerId}". Resource "${attemptedOwnerId}" cannot tunnel it again. Ensure each task is owned by a single tunnel client.`,
  )
  .build();

export function isCancellationError(err: unknown): boolean {
  return cancellationError.is(err);
}

// Backward-compatible namespace export for external imports (index.ts already re-exports * as Errors from here)
export type { IErrorHelper } from "./types/error";
