import { frameworkError as error } from "../../definers/builders/error";
import type { DefaultErrorType } from "../../types/error";

// Circular dependencies
export const circularDependencyError = error<
  { cycles: string[] } & DefaultErrorType
>("runner.errors.circularDependencies")
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

/** @deprecated Use circularDependencyError instead. */
export const circularDependenciesError = circularDependencyError;

/** @deprecated Use circularDependencyError instead. */
export const dependencyCycleError = circularDependencyError;

// Event cycle (runtime)
export const eventCycleError = error<
  {
    path: Array<{
      id: string;
      source: { kind: string; id: string; path?: string };
    }>;
  } & DefaultErrorType
>("runner.errors.eventCycle")
  .format(({ path }) => {
    const chain = path
      .map((p) => `${p.id}<-${p.source.kind}:${p.source.path ?? p.source.id}`)
      .join("  ->  ");
    return `Event emission cycle detected:\n  ${chain}\n\nBreak the cycle by changing hook logic (avoid mutual emits) or gate with conditions/tags.`;
  })
  .remediation(
    "Refactor hooks to avoid circular event emissions. Use conditional guards, split events into finer-grained signals, or introduce an intermediate task to break the cycle.",
  )
  .build();

export const eventCycleDepthExceededError = error<
  { eventId: string; currentDepth: number; maxDepth: number } & DefaultErrorType
>("runner.errors.eventCycleDepthExceeded")
  .format(
    ({ eventId, currentDepth, maxDepth }) =>
      `Emission stack exceeded ${maxDepth} frames while processing event "${eventId}" (current depth: ${currentDepth}).`,
  )
  .remediation(
    ({ eventId }) =>
      `Inspect hooks emitting "${eventId}" for runaway re-emission loops, or disable runtimeEventCycleDetection only when you can guarantee bounded emissions.`,
  )
  .build();

// Event emission cycles (compile-time/dry-run)
export const eventEmissionCycleError = error<
  { cycles: string[] } & DefaultErrorType
>("runner.errors.eventEmissionCycle")
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
>("runner.errors.transactionalParallelConflict")
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
  { eventId: string; tagId: string } & DefaultErrorType
>("runner.errors.transactionalEventLaneConflict")
  .format(
    ({ eventId, tagId }) =>
      `Event "${eventId}" cannot be transactional while using lane tag "${tagId}".`,
  )
  .remediation(
    ({ eventId }) =>
      `Remove .transactional() or remove runner.tags.eventLane from "${eventId}". Transactional events rely on in-process rollback semantics.`,
  )
  .build();

export const eventLaneRpcLaneConflictError = error<
  {
    eventId: string;
    eventLaneTagId: string;
    rpcLaneTagId: string;
  } & DefaultErrorType
>("runner.errors.eventLaneRpcLaneConflict")
  .format(
    ({ eventId, eventLaneTagId, rpcLaneTagId }) =>
      `Event "${eventId}" cannot define both lane tags "${eventLaneTagId}" and "${rpcLaneTagId}".`,
  )
  .remediation(
    ({ eventId }) =>
      `Pick one lane model for "${eventId}": use runner.tags.eventLane for async queue delivery, or runner.tags.rpcLane for synchronous RPC-style delivery.`,
  )
  .build();

export const transactionalMissingUndoClosureError = error<
  {
    eventId: string;
    listenerId?: string;
    listenerOrder?: number;
  } & DefaultErrorType
>("runner.errors.transactionalMissingUndoClosure")
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
>("runner.errors.transactionalRollbackFailure")
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
