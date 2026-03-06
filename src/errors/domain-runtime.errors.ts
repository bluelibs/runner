import { frameworkError as error } from "../definers/builders/error";
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
      `${clientFactory}: eventWithResult not available on underlying remote-lane HTTP client.`,
  )
  .remediation(
    "Use a remote-lane HTTP client/server pair that supports event return payloads, or fall back to fire-and-forget events.",
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

export const rpcLaneHttpClientPresetNotFoundError = error<
  { presetId: string; availablePresets: string[] } & DefaultErrorType
>(RunnerErrorId.RpcLaneHttpClientPresetNotFound)
  .format(
    ({ presetId, availablePresets }) =>
      `rpcLane.httpClient preset "${presetId}" is not registered. Available presets: ${availablePresets.join(", ")}.`,
  )
  .remediation(
    'Use a registered preset id. Core provides "fetch". Node entry registers "mixed" and "smart".',
  )
  .build();

export const rpcLaneCommunicatorContractError = error<
  { message: string } & DefaultErrorType
>(RunnerErrorId.RpcLaneCommunicatorContract)
  .format(({ message }) => message)
  .remediation(
    "Ensure communicator exposes task(id, input), event(id, payload), or eventWithResult(id, payload), and each method returns a promise.",
  )
  .build();

export const rpcLaneInvalidIdError = error<{ id: string } & DefaultErrorType>(
  "runner.errors.rpcLane.invalidId",
)
  .format(
    ({ id }) =>
      `rpcLane id must be a non-empty string. Received "${id.length === 0 ? "<empty>" : id}".`,
  )
  .remediation(
    "Provide a non-empty rpcLane id when calling defineRpcLane(...) or r.rpcLane(...).",
  )
  .build();

export const rpcLaneProfileNotFoundError = error<
  { profile: string } & DefaultErrorType
>(RunnerErrorId.RpcLaneProfileNotFound)
  .format(
    ({ profile }) => `rpcLane profile "${profile}" not found in topology.`,
  )
  .remediation(
    ({ profile }) =>
      `Define profile "${profile}" in r.rpcLane.topology({ profiles }) or choose an existing profile.`,
  )
  .build();

export const rpcLaneBindingNotFoundError = error<
  { laneId: string } & DefaultErrorType
>(RunnerErrorId.RpcLaneBindingNotFound)
  .format(
    ({ laneId }) =>
      `rpcLane binding not found for lane "${laneId}". Every tagged or served rpc lane must have a communicator binding.`,
  )
  .remediation(
    ({ laneId }) =>
      `Add a binding for lane "${laneId}" in r.rpcLane.topology({ bindings: [...] }).`,
  )
  .build();

export const rpcLaneDuplicateBindingError = error<
  { laneId: string } & DefaultErrorType
>("runner.errors.rpcLane.duplicateBinding")
  .format(
    ({ laneId }) =>
      `rpcLane "${laneId}" is bound multiple times. Define exactly one communicator binding per lane.`,
  )
  .remediation(
    ({ laneId }) =>
      `Keep exactly one binding entry for rpcLane "${laneId}" in r.rpcLane.topology({ bindings: [...] }).`,
  )
  .build();

export const rpcLaneTaskAssignmentConflictError = error<
  {
    taskId: string;
    currentLaneId: string;
    attemptedLaneId: string;
  } & DefaultErrorType
>("runner.errors.rpcLane.taskAssignmentConflict")
  .format(
    ({ taskId, currentLaneId, attemptedLaneId }) =>
      `Task "${taskId}" is already assigned to rpcLane "${currentLaneId}". Cannot also assign rpcLane "${attemptedLaneId}" via applyTo().`,
  )
  .remediation(
    ({ taskId }) =>
      `Assign task "${taskId}" to exactly one rpcLane (either tag-based or applyTo), not multiple lanes.`,
  )
  .build();

export const rpcLaneEventAssignmentConflictError = error<
  {
    eventId: string;
    currentLaneId: string;
    attemptedLaneId: string;
  } & DefaultErrorType
>("runner.errors.rpcLane.eventAssignmentConflict")
  .format(
    ({ eventId, currentLaneId, attemptedLaneId }) =>
      `Event "${eventId}" is already assigned to rpcLane "${currentLaneId}". Cannot also assign rpcLane "${attemptedLaneId}" via applyTo().`,
  )
  .remediation(
    ({ eventId }) =>
      `Assign event "${eventId}" to exactly one rpcLane (either tag-based or applyTo), not multiple lanes.`,
  )
  .build();

export const rpcLaneApplyToInvalidTargetError = error<
  { laneId: string } & DefaultErrorType
>("runner.errors.rpcLane.applyToInvalidTarget")
  .format(
    ({ laneId }) =>
      `rpcLane "${laneId}" applyTo() received an invalid target. Expected a task, event, or non-empty id string.`,
  )
  .remediation(
    ({ laneId }) =>
      `Use r.rpcLane("${laneId}").applyTo([taskOrEventOrNonEmptyId]).`,
  )
  .build();

export const rpcLaneApplyToTargetTypeError = error<
  { laneId: string; targetId: string } & DefaultErrorType
>("runner.errors.rpcLane.applyToTargetType")
  .format(
    ({ laneId, targetId }) =>
      `rpcLane "${laneId}" applyTo target "${targetId}" must reference a task or event, but resolved to a non-task/event definition.`,
  )
  .remediation(
    ({ targetId }) =>
      `Change applyTo target "${targetId}" to a registered task/event definition id.`,
  )
  .build();

export const rpcLaneApplyToTargetNotFoundError = error<
  { laneId: string; targetId: string } & DefaultErrorType
>("runner.errors.rpcLane.applyToTargetNotFound")
  .format(
    ({ laneId, targetId }) =>
      `rpcLane "${laneId}" applyTo target "${targetId}" was not found in this container. Register it first or fix the id.`,
  )
  .remediation(
    ({ targetId }) =>
      `Register "${targetId}" in this container or fix the id used in rpcLane.applyTo(...).`,
  )
  .build();

export const rpcLaneAssignmentEventLaneConflictError = error<
  { eventId: string; rpcLaneId: string } & DefaultErrorType
>("runner.errors.rpcLane.eventLaneConflict")
  .format(
    ({ eventId, rpcLaneId }) =>
      `Event "${eventId}" cannot be assigned to rpcLane "${rpcLaneId}" because it is already assigned to an event lane.`,
  )
  .remediation(
    ({ eventId }) =>
      `Remove either eventLane or rpcLane assignment for event "${eventId}". A single event cannot belong to both lane systems.`,
  )
  .build();

export const rpcLaneCommunicatorResourceInvalidError = error<
  { resourceId: string } & DefaultErrorType
>(RunnerErrorId.RpcLaneCommunicatorResourceInvalid)
  .format(
    ({ resourceId }) =>
      `rpcLane communicator resource "${resourceId}" did not resolve to a valid communicator.`,
  )
  .remediation(
    ({ resourceId }) =>
      `Ensure resource "${resourceId}" init() returns an object with at least one RPC method: task(...), event(...), or eventWithResult(...).`,
  )
  .build();

export const rpcLanesExposureModeError = error<
  { mode: string } & DefaultErrorType
>("runner.errors.rpcLane.exposureMode")
  .format(
    ({ mode }) =>
      `rpcLanesResource.with({ exposure.http }) is only supported in mode "network". Received mode "${mode}".`,
  )
  .remediation(
    'Use mode: "network" when enabling exposure.http, or remove exposure.http for transparent/local-simulated modes.',
  )
  .build();

export const rpcLanesExposureOwnerInvalidError = error<
  { ownerResourceId: string } & DefaultErrorType
>(RunnerErrorId.RpcLaneExposureOwnerInvalid)
  .format(
    ({ ownerResourceId }) =>
      `RPC HTTP exposure can only be owned by "platform-node-resources-rpcLanes". Received owner "${ownerResourceId}".`,
  )
  .remediation(
    "Start RPC HTTP exposure only through rpcLanesResource.with({ exposure: { http: ... } }) in network mode.",
  )
  .build();

export const remoteLaneAuthSignerMissingError = error<
  { laneId: string; mode: string } & DefaultErrorType
>("runner.errors.remoteLanes.auth.signerMissing")
  .format(
    ({ laneId, mode }) =>
      `Lane "${laneId}" requires ${mode} signing material for produce flow, but no signer credentials were configured.`,
  )
  .remediation(({ laneId, mode }) =>
    mode === "jwt_hmac"
      ? `Configure binding auth for lane "${laneId}" with auth.secret (or auth.produceSecret) when using jwt_hmac.`
      : `Configure binding auth for lane "${laneId}" with auth.privateKey when using jwt_asymmetric.`,
  )
  .build();

export const remoteLaneAuthVerifierMissingError = error<
  { laneId: string; mode: string } & DefaultErrorType
>("runner.errors.remoteLanes.auth.verifierMissing")
  .format(
    ({ laneId, mode }) =>
      `Lane "${laneId}" requires ${mode} verification material for consume flow, but no verifier credentials were configured.`,
  )
  .remediation(({ laneId, mode }) =>
    mode === "jwt_hmac"
      ? `Configure binding auth for lane "${laneId}" with auth.secret (or auth.consumeSecret) when using jwt_hmac.`
      : `Configure binding auth for lane "${laneId}" with auth.publicKey or auth.publicKeysByKid when using jwt_asymmetric.`,
  )
  .build();

export const remoteLaneAuthUnauthorizedError = error<
  { laneId: string; reason: string } & DefaultErrorType
>("runner.errors.remoteLanes.auth.unauthorized")
  .format(
    ({ laneId, reason }) =>
      `Remote lane "${laneId}" authorization failed: ${reason}.`,
  )
  .httpCode(401)
  .remediation(
    ({ laneId }) =>
      `Ensure requests/messages for lane "${laneId}" include a valid JWT with matching lane claim and unexpired timestamps.`,
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

export const resourceForkGatewayUnsupportedError = error<
  { id: string } & DefaultErrorType
>(RunnerErrorId.ResourceForkGatewayUnsupported)
  .format(
    ({ id }) =>
      `Resource "${id}" cannot be forked because gateway resources suppress their own namespace segment.`,
  )
  .remediation(
    ({ id }) =>
      `Do not call .fork() on gateway resource "${id}". Register a distinct non-gateway resource, or compose separate gateway resources with unique registered children instead.`,
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

export const eventLaneQueueNotInitializedError = error<DefaultErrorType>(
  "runner.errors.eventLanes.queueNotInitialized",
)
  .format(() => "Event lane queue not initialized")
  .remediation(
    "Initialize the event lane queue connection/channel before enqueue/consume operations.",
  )
  .build();

export const eventLaneInvalidIdError = error<{ id: string } & DefaultErrorType>(
  "runner.errors.eventLanes.invalidId",
)
  .format(
    ({ id }) =>
      `eventLane id must be a non-empty string. Received "${id.length === 0 ? "<empty>" : id}".`,
  )
  .remediation(
    "Provide a non-empty eventLane id when calling defineEventLane(...) or r.eventLane(...).",
  )
  .build();

export const eventLaneProfileNotFoundError = error<
  { profile: string } & DefaultErrorType
>("runner.errors.eventLanes.profileNotFound")
  .format(({ profile }) => `Event lanes profile "${profile}" was not found.`)
  .remediation(
    ({ profile }) =>
      `Define profile "${profile}" under eventLanesResource.with({ topology: { profiles: ... } }) before startup.`,
  )
  .build();

export const eventLaneBindingNotFoundError = error<
  { laneId: string } & DefaultErrorType
>("runner.errors.eventLanes.bindingNotFound")
  .format(
    ({ laneId }) =>
      `Event lane "${laneId}" has no queue binding in eventLanesResource configuration.`,
  )
  .remediation(
    ({ laneId }) =>
      `Add a binding entry for lane "${laneId}" in eventLanesResource.with({ topology: { bindings: [...] } }).`,
  )
  .build();

export const eventLaneDuplicateBindingError = error<
  { laneId: string } & DefaultErrorType
>("runner.errors.eventLanes.duplicateBinding")
  .format(
    ({ laneId }) =>
      `Event lane "${laneId}" is bound multiple times. Define exactly one queue binding per lane.`,
  )
  .remediation(
    ({ laneId }) =>
      `Keep exactly one queue binding for event lane "${laneId}" in eventLanesResource.with({ topology: { bindings: [...] } }).`,
  )
  .build();

export const eventLaneRetryPolicyInvalidError = error<
  {
    laneId: string;
    field: "maxAttempts" | "retryDelayMs";
    value: string;
  } & DefaultErrorType
>("runner.errors.eventLanes.retryPolicyInvalid")
  .format(
    ({ laneId, field, value }) =>
      `Event lane "${laneId}" binding has invalid retry policy field "${field}" with value "${value}".`,
  )
  .remediation(({ field }) =>
    field === "maxAttempts"
      ? "Use a positive integer for maxAttempts (for example: 1, 2, 3...)."
      : "Use a non-negative number for retryDelayMs (milliseconds).",
  )
  .build();

export const eventLaneQueueReferenceInvalidError = error<
  { source: string } & DefaultErrorType
>("runner.errors.eventLanes.queueReferenceInvalid")
  .format(
    ({ source }) =>
      `Event lanes queue reference "${source}" did not resolve to a valid IEventLaneQueue instance.`,
  )
  .remediation(
    ({ source }) =>
      `Ensure "${source}" resolves to an object implementing enqueue/consume/ack/nack.`,
  )
  .build();

export const eventLaneAssignmentConflictError = error<
  {
    eventId: string;
    currentLaneId: string;
    attemptedLaneId: string;
  } & DefaultErrorType
>("runner.errors.eventLanes.assignmentConflict")
  .format(
    ({ eventId, currentLaneId, attemptedLaneId }) =>
      `Event "${eventId}" is already assigned to eventLane "${currentLaneId}". Cannot also assign eventLane "${attemptedLaneId}" via applyTo().`,
  )
  .remediation(
    ({ eventId }) =>
      `Assign event "${eventId}" to exactly one eventLane (either tag-based or applyTo), not multiple lanes.`,
  )
  .build();

export const eventLaneApplyToInvalidTargetError = error<
  { laneId: string } & DefaultErrorType
>("runner.errors.eventLanes.applyToInvalidTarget")
  .format(
    ({ laneId }) =>
      `eventLane "${laneId}" applyTo() received an invalid target. Expected an event or non-empty id string.`,
  )
  .remediation(
    ({ laneId }) =>
      `Use r.eventLane("${laneId}").applyTo([eventOrNonEmptyId]).`,
  )
  .build();

export const eventLaneApplyToTargetTypeError = error<
  { laneId: string; targetId: string } & DefaultErrorType
>("runner.errors.eventLanes.applyToTargetType")
  .format(
    ({ laneId, targetId }) =>
      `eventLane "${laneId}" applyTo target "${targetId}" must reference an event, but resolved to a non-event definition.`,
  )
  .remediation(
    ({ targetId }) =>
      `Change applyTo target "${targetId}" to a registered event definition id.`,
  )
  .build();

export const eventLaneApplyToTargetNotFoundError = error<
  { laneId: string; targetId: string } & DefaultErrorType
>("runner.errors.eventLanes.applyToTargetNotFound")
  .format(
    ({ laneId, targetId }) =>
      `eventLane "${laneId}" applyTo target "${targetId}" was not found in this container. Register it first or fix the id.`,
  )
  .remediation(
    ({ targetId }) =>
      `Register event "${targetId}" in this container or fix the id used in eventLane.applyTo(...).`,
  )
  .build();

export const eventLaneAssignmentRpcLaneConflictError = error<
  { eventId: string; eventLaneId: string } & DefaultErrorType
>("runner.errors.eventLanes.rpcLaneConflict")
  .format(
    ({ eventId, eventLaneId }) =>
      `Event "${eventId}" cannot be assigned to eventLane "${eventLaneId}" because it is already assigned to an rpcLane.`,
  )
  .remediation(
    ({ eventId }) =>
      `Remove either eventLane or rpcLane assignment for event "${eventId}". A single event cannot belong to both lane systems.`,
  )
  .build();

export const eventLaneEventNotRegisteredError = error<
  { eventId: string } & DefaultErrorType
>("runner.errors.eventLanes.eventNotRegistered")
  .format(
    ({ eventId }) =>
      `Event lane consumer received unknown event "${eventId}" (not registered in this runtime).`,
  )
  .remediation(
    ({ eventId }) =>
      `Register event "${eventId}" in the runtime or stop producing it for this profile.`,
  )
  .build();

export const eventLaneMessageMalformedError = error<
  { reason: string } & DefaultErrorType
>("runner.errors.eventLanes.messageMalformed")
  .format(({ reason }) => `Event lane message is malformed: ${reason}`)
  .remediation(
    "Ensure queue messages are produced by Event Lanes runtime or follow EventLaneMessage contract.",
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

export const lockableMapLockedError = error<
  { mapName: string } & DefaultErrorType
>(RunnerErrorId.LockableMapLocked)
  .format(({ mapName }) => `Cannot modify "${mapName}" — the map is locked.`)
  .remediation(
    ({ mapName }) =>
      `The "${mapName}" map is locked after initialization. Perform all modifications before calling run().`,
  )
  .build();
