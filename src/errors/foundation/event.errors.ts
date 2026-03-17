import { frameworkError as error } from "../../definers/builders/error";
import type { DefaultErrorType } from "../../types/error";

// Circular dependencies
export const circularDependencyError = error<
  { cycles: string[] } & DefaultErrorType
>("circularDependencies")
  .format(({ cycles }) => {
    const cycleDetails = cycles.map((cycle) => `  - ${cycle}`).join("\n");
    const hasMiddleware = cycles.some((cycle) => cycle.includes("middleware"));

    let guidance = "\n\nTo resolve circular dependencies:";
    guidance +=
      "\n  - Consider refactoring to reduce coupling between components";
    guidance += "\n  - Extract shared dependencies into separate resources";

    if (hasMiddleware) {
      guidance +=
        "\n  - For cross-cutting task behavior: use taskRunner.intercept(..., { when })";
      guidance +=
        "\n  - For subtree-scoped middleware: use resource.subtree({ tasks/resources: { middleware: [...] } })";
      guidance +=
        "\n  - Consider using events for communication instead of direct dependencies";
    }

    return `Circular dependencies detected:\n${cycleDetails}${guidance}`;
  })
  .remediation(
    "Break the cycle by extracting shared state into a new resource that both sides depend on, or use events for indirect communication.",
  )
  .build();

// Execution trace cycle (runtime — repetition-based)
export const executionCycleError = error<
  {
    frame: {
      kind: string;
      id: string;
      source: { kind: string; id: string };
    };
    repetitions: number;
    maxRepetitions: number;
    trace: readonly {
      kind: string;
      id: string;
      source: { kind: string; id: string };
    }[];
  } & DefaultErrorType
>("executionCycle")
  .format(({ frame, repetitions, maxRepetitions, trace }) => {
    const matching = trace
      .filter((f) => f.kind === frame.kind && f.id === frame.id)
      .map((f) => `${f.kind}:${f.id}<-${f.source.kind}:${f.source.id}`)
      .join(" → ");
    return `Execution cycle detected: ${frame.kind} "${frame.id}" appeared ${repetitions} times (max: ${maxRepetitions}).\n  ${matching}`;
  })
  .remediation(
    "Break the cycle by restructuring task/event/hook dependencies, using conditional guards, or reducing re-entrant calls.",
  )
  .build();

// Execution trace depth exceeded (runtime)
export const executionDepthExceededError = error<
  {
    frame: { kind: string; id: string };
    currentDepth: number;
    maxDepth: number;
  } & DefaultErrorType
>("executionDepthExceeded")
  .format(
    ({ frame, currentDepth, maxDepth }) =>
      `Execution trace exceeded ${maxDepth} frames while processing ${frame.kind} "${frame.id}" (current depth: ${currentDepth}).`,
  )
  .remediation(
    "Inspect the call chain for runaway recursion. Consider increasing maxDepth in resources.executionContext.with({ cycleDetection: { maxDepth } }) if the depth is expected.",
  )
  .build();

// Event emission cycles (compile-time/dry-run)
export const eventEmissionCycleError = error<
  { cycles: string[] } & DefaultErrorType
>("eventEmissionCycle")
  .format(({ cycles }) => {
    const list = cycles.map((c) => `  - ${c}`).join("\n");
    return `Event emission cycles detected between hooks and events:\n${list}\n\nThis was detected at compile time (dry-run). Break the cycle by avoiding mutual emits between hooks or scoping hooks using tags.`;
  })
  .remediation(
    "Redesign the event/hook graph so no hook emits an event that eventually triggers itself. Use tags or conditional logic to prevent re-entrant emissions.",
  )
  .build();

export const transactionalParallelConflictError = error<
  { eventId: string } & DefaultErrorType
>("transactionalParallelConflict")
  .format(
    ({ eventId }) =>
      `Event "${eventId}" cannot be both transactional and parallel.`,
  )
  .remediation(
    ({ eventId }) =>
      `Remove either .transactional() or .parallel() from "${eventId}". Transactional listeners must run sequentially to support rollback.`,
  )
  .build();

export const transactionalEventLaneConflictError = error<
  { eventId: string; laneId: string } & DefaultErrorType
>("transactionalEventLaneConflict")
  .format(
    ({ eventId, laneId }) =>
      `Event "${eventId}" cannot be transactional while assigned to eventLane "${laneId}".`,
  )
  .remediation(
    ({ eventId }) =>
      `Remove .transactional() or stop routing "${eventId}" through Event Lanes. Transactional events rely on in-process rollback semantics.`,
  )
  .build();

export const eventLaneTagDeprecatedError = error<
  { eventId: string; tagId: string } & DefaultErrorType
>("eventLaneTagDeprecated")
  .format(
    ({ eventId, tagId }) =>
      `Event "${eventId}" uses deprecated tag "${tagId}".`,
  )
  .remediation(
    ({ eventId }) =>
      `Move Event Lane routing for "${eventId}" to r.eventLane(...).applyTo([...]) and remove the deprecated tag.`,
  )
  .build();

export const eventLaneHookTagDeprecatedError = error<
  { hookId: string; tagId: string } & DefaultErrorType
>("eventLaneHookTagDeprecated")
  .format(
    ({ hookId, tagId }) => `Hook "${hookId}" uses deprecated tag "${tagId}".`,
  )
  .remediation(
    ({ hookId }) =>
      `Move relay hook policy for "${hookId}" into eventLane topology consume entries via hooks.only and remove the deprecated tag.`,
  )
  .build();

export const eventLaneHookPolicyConflictError = error<
  {
    hookId: string;
    tagId: string;
    profile: string;
    laneId: string;
  } & DefaultErrorType
>("eventLaneHookPolicyConflict")
  .format(
    ({ hookId, tagId, profile, laneId }) =>
      `Hook "${hookId}" cannot combine deprecated tag "${tagId}" with topology hooks.only policy for profile "${profile}" lane "${laneId}".`,
  )
  .remediation(
    ({ hookId }) =>
      `Keep hook policy for "${hookId}" in topology only: remove the deprecated tag and manage relay hook allowlists through profiles[profile].consume[].hooks.only.`,
  )
  .build();

export const eventLaneHookPolicyHookReferenceInvalidError = error<
  {
    resourceId: string;
    profile: string;
    laneId: string;
    hookId: string;
  } & DefaultErrorType
>("eventLaneHookPolicyHookReferenceInvalid")
  .format(
    ({ resourceId, profile, laneId, hookId }) =>
      `Event Lanes resource "${resourceId}" profile "${profile}" lane "${laneId}" references hook "${hookId}" in hooks.only, but that hook is not registered.`,
  )
  .remediation(
    ({ hookId }) =>
      `Register hook "${hookId}" in the app before referencing it from hooks.only.`,
  )
  .build();

export const eventLaneConsumeDuplicateLaneError = error<
  {
    resourceId: string;
    profile: string;
    laneId: string;
  } & DefaultErrorType
>("eventLaneConsumeDuplicateLane")
  .format(
    ({ resourceId, profile, laneId }) =>
      `Event Lanes resource "${resourceId}" declares lane "${laneId}" more than once in profile "${profile}" consume.`,
  )
  .remediation(
    ({ laneId, profile }) =>
      `Keep lane "${laneId}" only once inside profile "${profile}" consume. Merge hook policy into a single consume entry for that lane.`,
  )
  .build();

export const eventLaneRpcLaneConflictError = error<
  {
    eventId: string;
    eventLaneTagId: string;
    rpcLaneTagId: string;
  } & DefaultErrorType
>("eventLaneRpcLaneConflict")
  .format(
    ({ eventId, eventLaneTagId, rpcLaneTagId }) =>
      `Event "${eventId}" cannot define both lane tags "${eventLaneTagId}" and "${rpcLaneTagId}".`,
  )
  .remediation(
    ({ eventId }) =>
      `Pick one lane model for "${eventId}": route it through r.eventLane(...).applyTo([...]) for async queue delivery, or use RPC Lane routing for synchronous RPC-style delivery.`,
  )
  .build();

export const transactionalMissingUndoClosureError = error<
  {
    eventId: string;
    listenerId?: string;
    listenerOrder?: number;
  } & DefaultErrorType
>("transactionalMissingUndoClosure")
  .format(
    ({ eventId, listenerId, listenerOrder }) =>
      `Transactional listener for event "${eventId}" did not return an undo closure (listenerId=${listenerId ?? "unknown"}, order=${listenerOrder ?? "unknown"}).`,
  )
  .remediation(
    () =>
      "Ensure every listener for transactional events returns an async undo closure: `async () => { /* revert */ }`.",
  )
  .build();

export const transactionalRollbackFailureError = error<
  {
    eventId: string;
    triggerMessage: string;
    triggerListenerId?: string;
    triggerListenerOrder?: number;
    rollbackFailures: Array<{
      message: string;
      listenerId?: string;
      listenerOrder?: number;
    }>;
  } & DefaultErrorType
>("transactionalRollbackFailure")
  .format(
    ({
      eventId,
      triggerMessage,
      triggerListenerId,
      triggerListenerOrder,
      rollbackFailures,
    }) => {
      const rollbackLines = rollbackFailures
        .map(
          (failure) =>
            `  - listenerId=${failure.listenerId ?? "unknown"}, order=${failure.listenerOrder ?? "unknown"}, message=${failure.message}`,
        )
        .join("\n");

      return `Transactional event "${eventId}" failed and rollback had ${rollbackFailures.length} error(s).\nTrigger: ${triggerMessage} (listenerId=${triggerListenerId ?? "unknown"}, order=${triggerListenerOrder ?? "unknown"})\nRollback failures:\n${rollbackLines}`;
    },
  )
  .remediation(
    () =>
      "Inspect rollback handlers and make them idempotent/resilient. The original trigger failure is preserved as the error cause.",
  )
  .build();
