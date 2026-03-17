import { frameworkError as error } from "../../definers/builders/error";
import type { DefaultErrorType } from "../../types/error";

// Lazy resource sync access blocked
export const lazyResourceSyncAccessError = error<
  { id: string } & DefaultErrorType
>("lazyResourceSyncAccess")
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
  "lazyResourceAccessDisabled",
)
  .format(
    () =>
      "RunResult.getLazyResourceValue() is only available when run(..., { lazy: true }) is enabled.",
  )
  .remediation(
    "Enable lazy mode via run(app, { lazy: true }) to use getLazyResourceValue(), or use getResourceValue() in non-lazy runtimes.",
  )
  .build();

export const lazyResourceShutdownAccessError = error<
  { id: string } & DefaultErrorType
>("lazyResourceShutdownAccess")
  .format(
    ({ id }) =>
      `Resource "${id.toString()}" cannot be lazy-initialized because shutdown has already started.`,
  )
  .remediation(
    ({ id }) =>
      `Request "${id.toString()}" via getLazyResourceValue() before runtime.dispose() begins, or create a fresh runtime after shutdown completes.`,
  )
  .build();

// Locked
export const lockedError = error<{ what: string } & DefaultErrorType>("locked")
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
  "storeAlreadyInitialized",
)
  .format(() => "Store already initialized. Cannot reinitialize.")
  .remediation(
    "Do not call run() more than once on the same resource tree. Create a fresh resource if you need a separate runtime.",
  )
  .build();

// Cancellation error (maps to HTTP 499 in exposure)
export const cancellationError = error<{ reason?: string } & DefaultErrorType>(
  "cancellation",
)
  .format(({ reason }) => reason || "Operation cancelled")
  .remediation(
    "The operation was cancelled, typically via an AbortController signal. If this is unexpected, check timeout middleware settings or ensure the caller is not aborting prematurely.",
  )
  .build();

// RunResult/runtime surface errors (kept message-compatible with existing API expectations)
export const runResultDisposedError = error<DefaultErrorType>(
  "runResultDisposed",
)
  .format(() => "RunResult has been disposed.")
  .remediation(
    "Create a new runtime via run(...) before calling runtime APIs again. Dispose is terminal for a RunResult instance.",
  )
  .build();

export const interceptAfterLockError = error<
  { taskId?: string; source?: string } & DefaultErrorType
>("interceptAfterLock")
  .format(({ taskId, source }) => {
    const target = taskId ? ` on task "${taskId}"` : "";
    const caller = source ? ` from "${source}"` : "";
    return `Cannot register a task interceptor${target}${caller} after the runtime has been locked. Interceptors must be registered during init().`;
  })
  .remediation(
    "Move your intercept() call into a resource's init() function where the middleware stack is still mutable. After store.lock(), the middleware composition is frozen and cached per task \u2014 late interceptors would create inconsistency between already-cached and newly-composed runners.",
  )
  .build();

export const shutdownLockdownError = error<DefaultErrorType>("shutdownLockdown")
  .format(
    () =>
      "Runtime is shutting down and no new task runs or event emissions are accepted.",
  )
  .remediation(
    "Wait for shutdown to complete before submitting new work, or start a new runtime via run(...).",
  )
  .build();

export const runtimeAdmissionsPausedError = error<DefaultErrorType>(
  "runtimeAdmissionsPaused",
)
  .format(
    () =>
      "Runtime is paused and no new task runs or event emissions are accepted.",
  )
  .remediation(
    "Wait for runtime.resume() or recovery conditions to reopen admissions before submitting new work.",
  )
  .build();

export const runtimeRootNotAvailableError = error<DefaultErrorType>(
  "runtimeRootNotAvailable",
)
  .format(() => "Root resource is not available.")
  .remediation(
    "Ensure run(...) completed successfully and you are not in dry-run mode when accessing the root value.",
  )
  .build();

export const runResultDisposeDuringBootstrapError = error<DefaultErrorType>(
  "runResultDisposeDuringBootstrap",
)
  .format(
    () =>
      "RunResult.dispose() is not available during bootstrap. Wait for run() to finish initialization.",
  )
  .remediation(
    "Call dispose() only after run(...) resolves and the runtime is fully initialized.",
  )
  .build();

export const runtimeHealthDuringBootstrapError = error<DefaultErrorType>(
  "runtimeHealthDuringBootstrap",
)
  .format(
    () =>
      "Health checks are not available during bootstrap. Wait for run() to finish initialization.",
  )
  .remediation(
    "Call getHealth() only after run(...) resolves and before dispose() starts.",
  )
  .build();

export const runtimeAdmissionControlDuringBootstrapError =
  error<DefaultErrorType>("runtimeAdmissionControlDuringBootstrap")
    .format(
      () =>
        "Runtime pause/resume controls are not available during bootstrap. Wait for run() to finish initialization.",
    )
    .remediation(
      "Call pause(), resume(), or recoverWhen() only after run(...) resolves and before dispose() starts.",
    )
    .build();

export const runtimeTimersNotAcceptingError = error<DefaultErrorType>(
  "runtimeTimersNotAccepting",
)
  .format(
    () =>
      "Runner timers are no longer accepting new timers because cooldown or disposal has started.",
  )
  .remediation(
    "Schedule timers before shutdown begins, or create a fresh runtime if you need new lifecycle-owned timers.",
  )
  .build();

export const runtimeElementNotFoundError = error<
  { type: string; elementId: string } & DefaultErrorType
>("runtimeElementNotFound")
  .format(
    ({ type, elementId }) =>
      `${type.toString()} "${elementId.toString()}" not found.`,
  )
  .remediation(
    ({ type, elementId }) =>
      `Register ${type.toString()} "${elementId.toString()}" in the root resource tree before requesting it from the runtime.`,
  )
  .build();

export const subtreeMiddlewareConflictError = error<
  {
    middlewareId: string;
    targetKind: "task" | "resource";
  } & DefaultErrorType
>("subtreeMiddlewareConflict")
  .format(({ middlewareId, targetKind }) => {
    const targetLabel = targetKind === "task" ? "task-local" : "resource-local";
    return `Subtree middleware "${middlewareId}" conflicts with a ${targetLabel} middleware using the same id.`;
  })
  .remediation(({ middlewareId, targetKind }) => {
    const targetLabel = targetKind === "task" ? "task-local" : "resource-local";
    return `Remove either the subtree middleware or the ${targetLabel} middleware for "${middlewareId}". Runner no longer allows local middleware to override subtree middleware with the same id.`;
  })
  .build();

export const healthReportEntryNotFoundError = error<
  { resourceId: string } & DefaultErrorType
>("healthReportEntryNotFound")
  .format(
    ({ resourceId }) =>
      `Health report entry for resource "${resourceId}" was not found.`,
  )
  .remediation(
    ({ resourceId }) =>
      `Ensure resource "${resourceId}" was included in getHealth(...), defines health(), and was not skipped as a sleeping lazy resource.`,
  )
  .build();

export const runtimeRecoverWhenRequiresPausedStateError =
  error<DefaultErrorType>("runtimeRecoverWhenRequiresPausedState")
    .format(() => "runtime.recoverWhen() requires the runtime to be paused.")
    .remediation(
      "Call runtime.pause() first, then register recovery conditions with runtime.recoverWhen(...).",
    )
    .build();

export const resourceCooldownAdmissionTargetInvalidError = error<
  { resourceId: string; targetId: string } & DefaultErrorType
>("resourceCooldownAdmissionTargetInvalid")
  .format(
    ({ resourceId, targetId }) =>
      `Resource "${resourceId}" returned invalid cooldown admission target "${targetId}".`,
  )
  .remediation(
    ({ targetId }) =>
      `Return only registered resource definitions from cooldown(). The target "${targetId}" must belong to the current runtime.`,
  )
  .build();

// Runtime API access blocked — target is not in the root resource's exported set
export const runtimeAccessViolationError = error<
  {
    targetId: string;
    targetType: "Task" | "Event" | "Resource";
    rootId: string;
    exportedIds: string[];
    exportsDeclared: boolean;
  } & DefaultErrorType
>("runtimeAccessViolation")
  .format(
    ({ targetId, rootId }) =>
      `"${targetId}" is not exported by root resource "${rootId}" and cannot be accessed via the runtime API.`,
  )
  .remediation(({ targetId, rootId, exportedIds, exportsDeclared }) => {
    const exported = !exportsDeclared
      ? `Root "${rootId}" does not declare any exports.`
      : exportedIds.length > 0
        ? `Root "${rootId}" currently exports: [${exportedIds.join(", ")}].`
        : `Root "${rootId}" declares exports but currently exports none.`;
    return `${exported} Add "${targetId}" to the root's .isolate({ exports: [...] }) to allow runtime API access.`;
  })
  .build();

export const taskHealthResourceNotReportableError = error<
  {
    taskId: string;
    resourceIds: string[];
  } & DefaultErrorType
>("taskHealthResourceNotReportable")
  .format(
    ({ taskId, resourceIds }) =>
      `Task "${taskId}" uses failWhenUnhealthy for resources without health(): [${resourceIds.join(", ")}].`,
  )
  .remediation(
    ({ resourceIds }) =>
      `Add health() to these resources or remove them from tags.failWhenUnhealthy.with([...]): [${resourceIds.join(", ")}].`,
  )
  .build();

export const taskBlockedByResourceHealthError = error<
  {
    taskId: string;
    resourceIds: string[];
  } & DefaultErrorType
>("taskBlockedByResourceHealth")
  .format(
    ({ taskId, resourceIds }) =>
      `Task "${taskId}" was blocked because these resources are unhealthy: [${resourceIds.join(", ")}].`,
  )
  .remediation(
    ({ resourceIds }) =>
      `Restore resource health before retrying the task, or remove them from tags.failWhenUnhealthy.with([...]): [${resourceIds.join(", ")}].`,
  )
  .build();

export const identityContextRequiredError = error<DefaultErrorType>(
  "identityContextRequired",
)
  .format(
    () =>
      "Identity context is required but not available. Provide the runtime's active identity async context before running identity-sensitive work.",
  )
  .remediation(
    "Wrap identity-sensitive work in your configured identity context's provide(...). If you rely on the built-in default, use asyncContexts.identity.provide(...). Omit identityScope only when cross-identity sharing is intentional.",
  )
  .build();

export const identityInvalidContextError = error<
  { reason?: string } & DefaultErrorType
>("identityInvalidContext")
  .format(
    ({ reason }) =>
      reason ??
      'Identity context may include "tenantId" and "userId", and any provided ids must be non-empty strings that do not contain ":" while "tenantId" must not be "__global__".',
  )
  .remediation(
    'Provide an identity async context value whose ids are valid strings. If you use the built-in default context, call asyncContexts.identity.provide({ tenantId: "your-tenant", userId: "your-user" }, fn) or omit fields that are not known yet.',
  )
  .build();

export const identityRunOptionRequiresAsyncLocalStorageError = error<
  { contextId: string } & DefaultErrorType
>("identityRunOptionRequiresAsyncLocalStorage")
  .format(
    ({ contextId }) =>
      `run(..., { identity }) requires AsyncLocalStorage, but the configured identity context "${contextId}" is running in an environment without it.`,
  )
  .remediation(
    ({ contextId }) =>
      `Use run(..., { identity: ${contextId} }) only on platforms with AsyncLocalStorage support, or omit the identity run option in browser-like runtimes.`,
  )
  .build();

export const identityRunOptionContextNotRegisteredError = error<
  { contextId: string } & DefaultErrorType
>("identityRunOptionContextNotRegistered")
  .format(
    ({ contextId }) =>
      `run(..., { identity }) received async context "${contextId}", but Runner could not register it for this runtime.`,
  )
  .remediation(
    ({ contextId }) =>
      `Ensure async context "${contextId}" is a valid Runner async context accessor. Runner auto-registers the configured identity context for dependency usage, but remote lanes still require normal async-context allowlisting for transport forwarding.`,
  )
  .build();
