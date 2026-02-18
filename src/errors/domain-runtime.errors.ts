import { error } from "../definers/builders/error";
import type { DefaultErrorType } from "../types/error";
import { RunnerErrorId } from "./domain-error-ids";

export const httpBaseUrlRequiredError = error<
  { clientFactory: string } & DefaultErrorType
>(RunnerErrorId.HttpBaseUrlRequired)
  .format(({ clientFactory }) => `${clientFactory} requires baseUrl`)
  .remediation(
    ({ clientFactory }) =>
      `Pass a non-empty baseUrl to ${clientFactory}. Example: ${clientFactory}({ baseUrl: "http://localhost:3000/__runner", ... }).`,
  )
  .build();

export const httpFetchUnavailableError = error<
  { clientFactory: string } & DefaultErrorType
>(RunnerErrorId.HttpFetchUnavailable)
  .format(
    ({ clientFactory }) =>
      `${clientFactory}: global fetch is not available; provide fetchImpl in config`,
  )
  .remediation(
    "Provide fetchImpl in configuration, or run in an environment with a global fetch implementation.",
  )
  .build();

export const httpContextSerializationError = error<
  { contextId: string; reason: string } & DefaultErrorType
>(RunnerErrorId.HttpContextSerialization)
  .format(
    ({ contextId, reason }) =>
      `Failed to serialize async context "${contextId}" for HTTP request: ${reason}`,
  )
  .remediation(
    ({ contextId }) =>
      `Ensure context "${contextId}" is available in the current async scope and serializes correctly.`,
  )
  .build();

export const httpEventWithResultUnavailableError = error<
  { clientFactory: string } & DefaultErrorType
>(RunnerErrorId.HttpEventWithResultUnavailable)
  .format(
    ({ clientFactory }) =>
      `${clientFactory}: eventWithResult not available on underlying tunnel client.`,
  )
  .remediation(
    "Use a tunnel client/server pair that supports event return payloads, or fall back to fire-and-forget events.",
  )
  .build();

export const httpClientInputUnsupportedError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.HttpClientInputUnsupported)
  .format(({ message }) => message)
  .remediation(
    "Use the Node smart/mixed HTTP clients for Node streams/files, or send JSON/browser File payloads with the universal client.",
  )
  .build();

export const middlewareConcurrencyConflictError = error<
  {
    key: string;
    existingLimit: number;
    attemptedLimit: number;
  } & DefaultErrorType
>(RunnerErrorId.MiddlewareConcurrencyConflict)
  .format(
    ({ key, existingLimit, attemptedLimit }) =>
      `Concurrency middleware key "${key}" is already registered with limit ${existingLimit}, but got ${attemptedLimit}`,
  )
  .remediation(
    ({ key }) =>
      `Use a consistent concurrency limit for key "${key}", or use a different key to isolate limits.`,
  )
  .build();

export const middlewareContextRequiredError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.MiddlewareContextRequired)
  .format(({ message }) => message)
  .remediation(
    "Ensure the required async context is provided before execution and middleware is wired with the matching context helper.",
  )
  .build();

export const middlewareTimeoutError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.MiddlewareTimeout)
  .format(({ message }) => message)
  .httpCode(408)
  .remediation(
    "Increase timeout ttl when appropriate, or optimize the operation to complete within the configured deadline.",
  )
  .build();

export const middlewareCircuitBreakerOpenError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.MiddlewareCircuitBreakerOpen)
  .format(({ message }) => message)
  .httpCode(503)
  .remediation(
    "Reduce downstream failures, tune circuit breaker thresholds/timeouts, or retry later when the circuit transitions back to HALF_OPEN/CLOSED.",
  )
  .build();

export const middlewareRateLimitExceededError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.MiddlewareRateLimitExceeded)
  .format(({ message }) => message)
  .httpCode(429)
  .remediation(
    "Reduce request frequency, increase allowed window/max limits, or retry after the configured reset time.",
  )
  .build();

export const middlewareTemporalDisposedError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.MiddlewareTemporalDisposed)
  .format(({ message }) => message)
  .remediation(
    "Ensure temporal middleware is not used after runtime disposal; create a fresh runtime instance before invoking tasks again.",
  )
  .build();

export const tunnelTaskNotFoundError = error<
  { taskId: string } & DefaultErrorType
>(RunnerErrorId.TunnelTaskNotFound)
  .format(
    ({ taskId }) =>
      `Task ${taskId} not found while trying to resolve tasks for tunnel.`,
  )
  .remediation(
    ({ taskId }) =>
      `Register task "${taskId}" in the runtime before tunnel middleware resolves task selectors.`,
  )
  .build();

export const tunnelEventNotFoundError = error<
  { eventId: string } & DefaultErrorType
>(RunnerErrorId.TunnelEventNotFound)
  .format(
    ({ eventId }) =>
      `Event ${eventId} not found while trying to resolve events for tunnel.`,
  )
  .remediation(
    ({ eventId }) =>
      `Register event "${eventId}" in the runtime before tunnel middleware resolves event selectors.`,
  )
  .build();

export const tunnelClientContractError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.TunnelClientContract)
  .format(({ message }) => message)
  .remediation(
    "In client/both tunnel mode, ensure the tunnel value exposes run(task, input) for tasks and emit(event, payload) for events.",
  )
  .build();

export const resourceForkInvalidIdError = error<
  { id: string } & DefaultErrorType
>(RunnerErrorId.ResourceForkInvalidId)
  .format(
    ({ id }) =>
      `resourceFork reId() must return a non-empty string for "${id}"`,
  )
  .remediation(
    "Provide a reId function that always returns a non-empty string for each registered item id.",
  )
  .build();

export const builderInvalidHttpCodeError = error<
  { value: number } & DefaultErrorType
>(RunnerErrorId.BuilderInvalidHttpCode)
  .format(
    ({ value }) =>
      `Error httpCode must be an integer between 100 and 599. Received: ${value}`,
  )
  .remediation(
    "Use a valid HTTP status code in the 100-599 range when configuring error helpers.",
  )
  .build();

export const overrideUnsupportedBaseError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.OverrideUnsupportedBase)
  .format(({ message }) => message)
  .remediation(
    "Only override supported runner definitions (task/resource/hook/middleware/error) and ensure the base is a valid definition instance.",
  )
  .build();

export const platformUnreachableError = error<DefaultErrorType>(
  RunnerErrorId.PlatformUnreachable,
)
  .format(() => "Platform adapter reached an unreachable branch.")
  .remediation(
    "This indicates an internal control-flow bug. Please report with a minimal reproduction.",
  )
  .build();

// Clearer alias for the same helper; keep original export for compatibility.
export const platformInvariantError = platformUnreachableError;

export const serializerInvalidPayloadError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.SerializerInvalidPayload)
  .format(({ message }) => message)
  .remediation(
    "Validate serialized payload shape and types before deserialization.",
  )
  .build();

export const serializerValidationError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.SerializerValidation)
  .format(({ message }) => message)
  .remediation("Ensure serializer input satisfies validation constraints.")
  .build();

// Clearer alias for serializer-specific validation semantics.
export const serializerPayloadValidationError = serializerValidationError;

export const serializerDepthExceededError = error<
  { maxDepth: number } & DefaultErrorType
>(RunnerErrorId.SerializerDepthExceeded)
  .format(({ maxDepth }) => `Maximum depth exceeded (${maxDepth})`)
  .remediation(
    "Increase maxDepth only when needed and validate untrusted payload size/depth limits.",
  )
  .build();

export const serializerReferenceResolutionError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.SerializerReferenceResolution)
  .format(({ message }) => message)
  .remediation(
    "Ensure object references are valid and all referenced nodes exist in the payload graph.",
  )
  .build();

export const serializerUnsupportedFeatureError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.SerializerUnsupportedFeature)
  .format(({ message }) => message)
  .remediation(
    "Use only serializer features supported by the current runtime/platform settings.",
  )
  .build();

export const serializerTypeRegistryError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.SerializerTypeRegistry)
  .format(({ message }) => message)
  .remediation(
    "Register valid unique types with complete serialize/deserialize contracts.",
  )
  .build();

export const serializerSymbolPolicyError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.SerializerSymbolPolicy)
  .format(({ message }) => message)
  .remediation(
    "Adjust symbolPolicy or payload symbols to satisfy serializer symbol constraints.",
  )
  .build();

export const nodeInputFileConsumedError = error<DefaultErrorType>(
  RunnerErrorId.NodeInputFileConsumed,
)
  .format(() => "InputFile stream already consumed")
  .remediation(
    "InputFile streams are single-use. Store needed data before consuming or create a new InputFile instance.",
  )
  .build();

export const nodeInputFileUnavailableError = error<DefaultErrorType>(
  RunnerErrorId.NodeInputFileUnavailable,
)
  .format(() => "InputFile stream is not available")
  .remediation(
    "Ensure a valid stream is attached and has not been disposed before accessing it.",
  )
  .build();

export const nodeExposureMultipartLimitExceededError = error<
  { message: string; response?: unknown } & DefaultErrorType
>(RunnerErrorId.NodeExposureMultipartLimitExceeded)
  .format(({ message }) => message)
  .httpCode(413)
  .remediation(
    "Increase multipart limits only when safe, or reduce uploaded payload size/field counts to fit configured constraints.",
  )
  .build();

export const optionalDependencyInvalidExportError = error<
  { dependency: string; details: string } & DefaultErrorType
>(RunnerErrorId.OptionalDependencyInvalidExport)
  .format(
    ({ dependency, details }) => `Invalid '${dependency}' export${details}`,
  )
  .remediation(
    ({ dependency }) =>
      `Verify installed package "${dependency}" version and export shape match Runner expectations.`,
  )
  .build();

export const optionalDependencyMissingError = error<
  { dependency: string; details: string } & DefaultErrorType
>(RunnerErrorId.OptionalDependencyMissing)
  .format(
    ({ dependency, details }) =>
      `Missing optional dependency '${dependency}'.${details}`,
  )
  .remediation(
    ({ dependency }) =>
      `Install "${dependency}" or disable features requiring it in runtime configuration.`,
  )
  .build();

export const durableStoreShapeError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.DurableStoreShape)
  .format(({ message }) => message)
  .remediation(
    "Ensure durable store implementation returns values in the expected contract shape.",
  )
  .build();

export const durableQueueNotInitializedError = error<DefaultErrorType>(
  RunnerErrorId.DurableQueueNotInitialized,
)
  .format(() => "Queue not initialized")
  .remediation(
    "Initialize the durable queue connection/channel before push/consume operations.",
  )
  .build();

export const durableContextCancelledError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.DurableContextCancelled)
  .format(({ message }) => message)
  .remediation(
    "Check cancellation signals and workflow status transitions before invoking durable context operations.",
  )
  .build();

export const durableStepDefinitionError = error<
  { stepId: string } & DefaultErrorType
>(RunnerErrorId.DurableStepDefinition)
  .format(({ stepId }) => `Step ${stepId} has no up() function defined.`)
  .remediation(
    "Define the step body with .up(...) before awaiting/executing the step builder.",
  )
  .build();

export const durableDeterminismViolationError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.DurableDeterminismViolation)
  .format(({ message }) => message)
  .remediation(
    "Use deterministic step IDs/flow and avoid non-deterministic branching across replays.",
  )
  .build();

export const durableSignalTimeoutError = error<
  { signalId: string } & DefaultErrorType
>(RunnerErrorId.DurableSignalTimeout)
  .format(({ signalId }) => `Signal '${signalId}' timed out`)
  .remediation(
    ({ signalId }) =>
      `Emit signal "${signalId}" before timeout or increase timeout settings for this wait step.`,
  )
  .build();

export const durableScheduleConfigError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.DurableScheduleConfig)
  .format(({ message }) => message)
  .remediation(
    "Provide valid durable schedule configuration and ensure cron/interval values are valid.",
  )
  .build();

export const durableExecutionError = error<
  {
    message: string;
    executionId: string;
    taskId: string;
    attempt: number;
    causeInfo?: { message: string; stack?: string };
  } & DefaultErrorType
>(RunnerErrorId.DurableExecutionError)
  .format(({ message }) => message)
  .httpCode(500)
  .remediation(
    ({ executionId }) =>
      `Inspect durable execution "${executionId}" history and failure cause, then retry/resume based on workflow semantics.`,
  )
  .build();

export const durableExecutionInvariantError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.DurableExecutionInvariant)
  .format(({ message }) => message)
  .remediation(
    "This indicates an invalid durable execution state or configuration contract violation.",
  )
  .build();

export const durableOperatorUnsupportedStoreCapabilityError = error<
  { operation: string } & DefaultErrorType
>(RunnerErrorId.DurableOperatorUnsupportedStoreCapability)
  .format(({ operation }) => `Store does not support ${operation}`)
  .remediation(
    ({ operation }) =>
      `Use a durable store implementation that supports operator capability "${operation}".`,
  )
  .build();

export const dashboardApiRequestError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.DashboardApiRequest)
  .format(({ message }) => message)
  .remediation(
    "Verify dashboard API endpoint availability, authentication, and request payload shape.",
  )
  .build();

export const lockableMapLockedError = error<
  { mapName: string } & DefaultErrorType
>(RunnerErrorId.LockableMapLocked)
  .format(({ mapName }) => `Cannot modify "${mapName}" — the map is locked.`)
  .remediation(
    ({ mapName }) =>
      `The "${mapName}" map is locked after initialization. Perform all modifications before calling run().`,
  )
  .build();
