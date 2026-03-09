import { frameworkError as error } from "../../definers/builders/error";
import type { DefaultErrorType } from "../../types/error";

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

// Cancellation error (maps to HTTP 499 in exposure)
export const cancellationError = error<{ reason?: string } & DefaultErrorType>(
  "runner.errors.cancellation",
)
  .format(({ reason }) => reason || "Operation cancelled")
  .remediation(
    "The operation was cancelled, typically via an AbortController signal. If this is unexpected, check timeout middleware settings or ensure the caller is not aborting prematurely.",
  )
  .build();

// RunResult/runtime surface errors (kept message-compatible with existing API expectations)
export const runResultDisposedError = error<DefaultErrorType>(
  "runner.errors.runResultDisposed",
)
  .format(() => "RunResult has been disposed.")
  .remediation(
    "Create a new runtime via run(...) before calling runtime APIs again. Dispose is terminal for a RunResult instance.",
  )
  .build();

export const interceptAfterLockError = error<
  { taskId?: string; source?: string } & DefaultErrorType
>("runner.errors.interceptAfterLock")
  .format(({ taskId, source }) => {
    const target = taskId ? ` on task "${taskId}"` : "";
    const caller = source ? ` from "${source}"` : "";
    return `Cannot register a task interceptor${target}${caller} after the runtime has been locked. Interceptors must be registered during init().`;
  })
  .remediation(
    "Move your intercept() call into a resource's init() function where the middleware stack is still mutable. After store.lock(), the middleware composition is frozen and cached per task \u2014 late interceptors would create inconsistency between already-cached and newly-composed runners.",
  )
  .build();

export const shutdownLockdownError = error<DefaultErrorType>(
  "runner.errors.shutdownLockdown",
)
  .format(
    () =>
      "Runtime is shutting down and no new task runs or event emissions are accepted.",
  )
  .remediation(
    "Wait for shutdown to complete before submitting new work, or start a new runtime via run(...).",
  )
  .build();

export const runtimeAdmissionsPausedError = error<DefaultErrorType>(
  "runner.errors.runtimeAdmissionsPaused",
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
  "runner.errors.runtimeRootNotAvailable",
)
  .format(() => "Root resource is not available.")
  .remediation(
    "Ensure run(...) completed successfully and you are not in dry-run mode when accessing the root value.",
  )
  .build();

export const runResultDisposeDuringBootstrapError = error<DefaultErrorType>(
  "runner.errors.runResultDisposeDuringBootstrap",
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
  "runner.errors.runtimeHealthDuringBootstrap",
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
  error<DefaultErrorType>(
    "runner.errors.runtimeAdmissionControlDuringBootstrap",
  )
    .format(
      () =>
        "Runtime pause/resume controls are not available during bootstrap. Wait for run() to finish initialization.",
    )
    .remediation(
      "Call pause(), resume(), or recoverWhen() only after run(...) resolves and before dispose() starts.",
    )
    .build();

export const runtimeTimersNotAcceptingError = error<DefaultErrorType>(
  "runner.errors.runtimeTimersNotAccepting",
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
>("runner.errors.runtimeElementNotFound")
  .format(
    ({ type, elementId }) =>
      `${type.toString()} "${elementId.toString()}" not found.`,
  )
  .remediation(
    ({ type, elementId }) =>
      `Register ${type.toString()} "${elementId.toString()}" in the root resource tree before requesting it from the runtime.`,
  )
  .build();

export const healthReportEntryNotFoundError = error<
  { resourceId: string } & DefaultErrorType
>("runner.errors.healthReportEntryNotFound")
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
  error<DefaultErrorType>("runner.errors.runtimeRecoverWhenRequiresPausedState")
    .format(() => "runtime.recoverWhen() requires the runtime to be paused.")
    .remediation(
      "Call runtime.pause() first, then register recovery conditions with runtime.recoverWhen(...).",
    )
    .build();

// Runtime API access blocked — target is not in the root resource's exported set
export const runtimeAccessViolationError = error<
  {
    targetId: string;
    targetType: "Task" | "Event" | "Resource";
    rootId: string;
    exportedIds: string[];
  } & DefaultErrorType
>("runner.errors.runtimeAccessViolation")
  .format(
    ({ targetId, rootId }) =>
      `"${targetId}" is not exported by root resource "${rootId}" and cannot be accessed via the runtime API.`,
  )
  .remediation(({ targetId, rootId, exportedIds }) => {
    const exported =
      exportedIds.length > 0
        ? `Root "${rootId}" currently exports: [${exportedIds.join(", ")}].`
        : `Root "${rootId}" has no exports declared.`;
    return `${exported} Add "${targetId}" to the root's .isolate({ exports: [...] }) to allow runtime API access.`;
  })
  .build();

export const taskHealthResourceNotReportableError = error<
  {
    taskId: string;
    resourceIds: string[];
  } & DefaultErrorType
>("runner.errors.taskHealthResourceNotReportable")
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
>("runner.errors.taskBlockedByResourceHealth")
  .format(
    ({ taskId, resourceIds }) =>
      `Task "${taskId}" was blocked because these resources are unhealthy: [${resourceIds.join(", ")}].`,
  )
  .remediation(
    ({ resourceIds }) =>
      `Restore resource health before retrying the task, or remove them from tags.failWhenUnhealthy.with([...]): [${resourceIds.join(", ")}].`,
  )
  .build();
