import { error } from "./definers/builders/error";
import type { DefaultErrorType } from "./types/error";
import { detectEnvironment } from "./platform";

// Duplicate registration
export const duplicateRegistrationError = error<
  { type: string; id: string } & DefaultErrorType
>("runner.errors.duplicateRegistration")
  .format(
    ({ type, id }) =>
      `${type} "${id.toString()}" already registered. You might have used the same 'id' in two different components or you may have registered the same element twice.`,
  )
  .remediation(
    ({ type }) =>
      `Ensure each ${type} has a unique id. If you need the same definition in multiple places, use .fork() to create a copy with a new id.`,
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
  .remediation(
    ({ key }) =>
      `Register the dependency "${key.toString()}" in a parent resource using .register([${key.toString()}]). If the dependency is optional, use .optional() when declaring it.`,
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
  .remediation(
    "Check that all packages depend on the same version of '@bluelibs/runner'. Run 'npm ls @bluelibs/runner' to detect duplicates.",
  )
  .build();

// Context error
export const contextError = error<{ details?: string } & DefaultErrorType>(
  "runner.errors.context",
)
  .format(({ details }) => details ?? "Context error")
  .remediation(
    "Verify the async context is registered in a parent resource and that .provide() was called before .use(). If the context is optional, use .optional() when declaring the dependency.",
  )
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
  .remediation(
    "Break the cycle by extracting shared state into a new resource that both sides depend on, or use events for indirect communication.",
  )
  .build();

// Event not found
export const eventNotFoundError = error<{ id: string } & DefaultErrorType>(
  "runner.errors.eventNotFound",
)
  .format(
    ({ id }) =>
      `Event "${id.toString()}" not found. Did you forget to register it?`,
  )
  .remediation(
    ({ id }) =>
      `Add the event "${id.toString()}" to a parent resource via .register([yourEvent]). Ensure the event definition is built with r.event("${id.toString()}").build().`,
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
  .remediation(
    ({ id }) =>
      `Register the resource "${id.toString()}" in a parent resource via .register([yourResource]). Verify the id string matches exactly (ids are case-sensitive).`,
  )
  .build();

// Lazy resource sync access blocked
export const lazyResourceSyncAccessError = error<
  { id: string } & DefaultErrorType
>("runner.errors.lazyResourceSyncAccess")
  .format(
    ({ id }) =>
      `Resource "${id.toString()}" was not used during startup and cannot be read via getResourceValue() in lazy mode.`,
  )
  .remediation(
    ({ id }) =>
      `Use await runResult.getLazyResourceValue("${id.toString()}") to initialize and read this resource on demand, or disable lazy mode in run(..., { lazy: false }).`,
  )
  .build();

export const lazyResourceAccessDisabledError = error<DefaultErrorType>(
  "runner.errors.lazyResourceAccessDisabled",
)
  .format(
    () =>
      "RunResult.getLazyResourceValue() is only available when run(..., { lazy: true }) is enabled.",
  )
  .remediation(
    "Enable lazy mode via run(app, { lazy: true }) to use getLazyResourceValue(), or use getResourceValue() in non-lazy runtimes.",
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
  .remediation(
    ({ middlewareId }) =>
      `Register the middleware "${middlewareId}" alongside its consumer in a parent resource via .register([yourMiddleware]).`,
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
  .remediation(
    ({ id }) =>
      `Register the tag "${id}" in a parent resource via .register([yourTag]). Tags must be registered before they can be queried.`,
  )
  .build();

// Locked
export const lockedError = error<{ what: string } & DefaultErrorType>(
  "runner.errors.locked",
)
  .format(
    ({ what }) => `Cannot modify the ${what.toString()} when it is locked.`,
  )
  .remediation(
    ({ what }) =>
      `The ${what.toString()} is locked after initialization. Perform all modifications before calling run().`,
  )
  .build();

// Store already initialized
export const storeAlreadyInitializedError = error<DefaultErrorType>(
  "runner.errors.storeAlreadyInitialized",
)
  .format(() => "Store already initialized. Cannot reinitialize.")
  .remediation(
    "Do not call run() more than once on the same resource tree. Create a fresh resource if you need a separate runtime.",
  )
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
  .remediation(({ subject, id }) => {
    const lower = subject.toLowerCase();
    const schemaHint = lower.includes("input")
      ? "inputSchema"
      : lower.includes("config")
        ? "configSchema"
        : lower.includes("result")
          ? "resultSchema"
          : "schema";
    return `Check the ${subject} passed to "${id.toString()}". Ensure it matches the schema defined via .${schemaHint}().`;
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
  .remediation(
    "Refactor hooks to avoid circular event emissions. Use conditional guards, split events into finer-grained signals, or introduce an intermediate task to break the cycle.",
  )
  .build();

// Event emission cycles (compile-time/dry-run)
export const eventEmissionCycleError = error<
  { cycles: string[] } & DefaultErrorType
>("runner.errors.eventEmissionCycle")
  .format(({ cycles }) => {
    const list = cycles.map((c) => `  • ${c}`).join("\n");
    return `Event emission cycles detected between hooks and events:\n${list}\n\nThis was detected at compile time (dry-run). Break the cycle by avoiding mutual emits between hooks or scoping hooks using tags.`;
  })
  .remediation(
    "Redesign the event/hook graph so no hook emits an event that eventually triggers itself. Use tags or conditional logic to prevent re-entrant emissions.",
  )
  .build();

// Platform unsupported function
export const platformUnsupportedFunctionError = error<
  { functionName: string } & DefaultErrorType
>("runner.errors.platformUnsupportedFunction")
  .format(
    ({ functionName }) =>
      `Platform function not supported in this environment: ${functionName}. Detected platform: ${detectEnvironment()}.`,
  )
  .remediation(
    ({ functionName }) =>
      `The function "${functionName}" requires a Node.js environment. If running in a browser or edge runtime, use a platform-compatible alternative or guard the call with a platform check.`,
  )
  .build();

// Cancellation error (maps to HTTP 499 in exposure)
export const cancellationError = error<{ reason?: string } & DefaultErrorType>(
  "runner.errors.cancellation",
)
  .format(({ reason }) => reason || "Operation cancelled")
  .remediation(
    "The operation was cancelled, typically via an AbortController signal. If this is unexpected, check timeout middleware settings or ensure the caller is not aborting prematurely.",
  )
  .build();

// Tunnel ownership conflict (exclusive owner per task)
export const tunnelOwnershipConflictError = error<
  {
    taskId: string;
    currentOwnerId: string;
    attemptedOwnerId: string;
  } & DefaultErrorType
>("runner.errors.tunnelOwnershipConflict")
  .format(
    ({ taskId, currentOwnerId, attemptedOwnerId }) =>
      `Task "${taskId}" is already tunneled by resource "${currentOwnerId}". Resource "${attemptedOwnerId}" cannot tunnel it again. Ensure each task is owned by a single tunnel client.`,
  )
  .remediation(
    ({ taskId }) =>
      `Each task can only be tunneled by one client. Remove the duplicate tunnel registration for "${taskId}" or split the task into separate definitions with distinct ids.`,
  )
  .build();

// Phantom task executed without a matching tunnel route
export const phantomTaskNotRoutedError = error<
  { taskId: string } & DefaultErrorType
>("runner.errors.phantomTaskNotRouted")
  .format(
    ({ taskId }) =>
      `Phantom task "${taskId}" is not routed through any tunnel. Ensure a tunnel client selects this task id (or avoid calling the phantom task directly).`,
  )
  .remediation(
    ({ taskId }) =>
      `Configure a tunnel client resource to select "${taskId}" so it routes to a remote server. Phantom tasks cannot be executed locally — they only serve as local proxies for remote tasks.`,
  )
  .build();

// Task not registered in Store (internal invariant)
export const taskNotRegisteredError = error<
  { taskId: string } & DefaultErrorType
>("runner.errors.taskNotRegistered")
  .format(
    ({ taskId }) =>
      `Task "${taskId}" is not registered in the Store. This is an internal error—ensure the task is registered before execution.`,
  )
  .remediation(
    ({ taskId }) =>
      `Register the task "${taskId}" in a parent resource via .register([yourTask]) before calling run(). If this error persists, it may indicate an internal framework bug.`,
  )
  .build();

// RunResult/runtime surface errors (kept message-compatible with existing API expectations)
export const runResultDisposedError = error<DefaultErrorType>(
  "runner.errors.runResultDisposed",
)
  .format(() => "RunResult has been disposed.")
  .build();

export const runtimeRootNotAvailableError = error<DefaultErrorType>(
  "runner.errors.runtimeRootNotAvailable",
)
  .format(() => "Root resource is not available.")
  .build();

export const runtimeRootNotInitializedError = error<
  { rootId: string } & DefaultErrorType
>("runner.errors.runtimeRootNotInitialized")
  .format(
    ({ rootId }) =>
      `Root resource "${rootId.toString()}" is not initialized yet.`,
  )
  .build();

export const runResultDisposeDuringBootstrapError = error<DefaultErrorType>(
  "runner.errors.runResultDisposeDuringBootstrap",
)
  .format(
    () =>
      "RunResult.dispose() is not available during bootstrap. Wait for run() to finish initialization.",
  )
  .build();

export const runtimeElementNotFoundError = error<
  { type: string; elementId: string } & DefaultErrorType
>("runner.errors.runtimeElementNotFound")
  .format(
    ({ type, elementId }) =>
      `${type.toString()} "${elementId.toString()}" not found.`,
  )
  .build();

/** Builder types that require validation before build() */
export type BuilderType =
  | "task"
  | "hook"
  | "task-middleware"
  | "resource-middleware";

// Builder incomplete (missing required fields)
export const builderIncompleteError = error<
  {
    type: BuilderType;
    builderId: string;
    missingFields: string[];
  } & DefaultErrorType
>("runner.errors.builderIncomplete")
  .format(({ type, builderId, missingFields }) => {
    const typeLabel =
      type === "task"
        ? "Task"
        : type === "hook"
          ? "Hook"
          : type === "task-middleware"
            ? "Task middleware"
            : "Resource middleware";
    return `${typeLabel} "${builderId}" is incomplete. Missing required: ${missingFields.join(", ")}. Call ${missingFields.map((f) => `.${f}()`).join(" and ")} before .build().`;
  })
  .remediation(
    ({ missingFields }) =>
      `Add the missing builder steps: ${missingFields.map((f) => `.${f}()`).join(", ")} before calling .build().`,
  )
  .build();

// Backward-compatible namespace export for external imports (index.ts already re-exports * as Errors from here)
export type { IErrorHelper } from "./types/error";
