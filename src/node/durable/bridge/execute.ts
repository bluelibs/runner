import { normalizeError } from "../../../tools/normalizeError";
import type { Store } from "../../../models/store/Store";
import type { EventManager } from "../../../models/EventManager";
import type { Serializer } from "../../../serializer";
import type { IDurableContext } from "../core/interfaces/context";
import type { DurableEventInput } from "./types";
import { deepFreeze } from "../../../tools/deepFreeze";
import { runtimeShutdownAbortReason } from "../../../tools/runtimeShutdownAbortReason";
import { isDurableShutdownInterruptionError } from "../core/shutdownInterruption";
import { EventEmissionImpl } from "../../../models/event/EmissionContext";
import { getDefinitionIdentity } from "../../../tools/isSameDefinition";
import { createEmptyReport } from "../../../models/event/EmissionExecutor";
import { bridgeError, eventHooks } from "./plan";
import { ExecutionStatus } from "../core/types";
import {
  ContinuationSignal,
  SuspensionSignal,
} from "../core/interfaces/context";
import { isDurablePauseInterruptionError } from "../core/pauseInterruption";
import type { DurableResource } from "../core/DurableResource";
import type { IDurableStore } from "../core/interfaces/store";

type DurableEventRuntime = Pick<DurableResource, keyof DurableResource>;

interface Failure {
  message: string;
}
interface Phase {
  failure: Failure;
  cancelled?: boolean;
}

/** Executes persisted hook membership; compensation phase is independent of forward replay. */
export async function executeEvent(
  input: DurableEventInput,
  deps: {
    store: Store;
    manager: EventManager;
    serializer: Serializer;
    durable: DurableEventRuntime;
    backend: IDurableStore;
    inHook: <T>(fn: () => Promise<T>) => Promise<T>;
  },
) {
  const context = deps.durable.use();
  const definition = deps.store.events.get(input.eventId)?.event;
  if (!definition)
    bridgeError(`Durable event '${input.eventId}' is no longer registered.`);
  const available = new Map(
    eventHooks(deps.store, deps.manager, definition!, input.compensation).map(
      (listener) => [listener.id, listener],
    ),
  );
  // Membership and order belong to the emission; implementations belong to the deployment.
  const listeners = input.hookIds.map(
    (id) =>
      available.get(id) ??
      bridgeError(
        `Durable event '${input.eventId}' saved hook '${id}' is no longer registered for this event; restore it before recovery.`,
      ),
  );
  const execution = await deps.backend.getExecution(context.executionId);
  const phase = await deps.backend.getStepResult(
    context.executionId,
    "eventFailure",
  );
  let failure = phase?.result as Phase | undefined;
  const report = createEmptyReport(listeners.length);
  if (!failure) {
    for (const listener of listeners) {
      if (listener.id === input.source.id) {
        report.skippedListeners++;
        continue;
      }
      report.attemptedListeners++;
      try {
        await context.step(`hook:${listener.id}`, async ({ signal }) => {
          const event = makeEvent(
            context,
            input,
            definition!,
            listener.id!,
            signal,
            deps.serializer,
          );
          return deps.inHook(async () =>
            deps.serializer.parse(
              deps.serializer.stringify(
                await invokeHook(() => listener.handler(event)),
              ),
            ),
          );
        });
        report.succeededListeners++;
      } catch (error) {
        if (
          isDurablePauseInterruptionError(error) ||
          isDurableShutdownInterruptionError(error, runtimeShutdownAbortReason)
        )
          throw error;
        const current = await deps.backend.getExecution(context.executionId);
        // An abort caused by shutdown or pause parks work; it must not begin compensation.
        if (current?.status === "paused") throw error;
        if (
          !input.compensation ||
          (context.attempt < execution!.maxAttempts &&
            current?.status !== "cancelling")
        )
          throw error;
        failure = await context._compensate("eventFailure", async () => ({
          failure: {
            message: error instanceof Error ? error.message : String(error),
          },
          cancelled: current?.status === "cancelling",
        }));
        break;
      }
    }
  }
  if (!failure) return report;
  const errors: string[] = [];
  for (const listener of [...listeners].reverse()) {
    const result = await deps.backend.getStepResult(
      context.executionId,
      `hook:${listener.id}`,
    );
    if (!result) continue;
    const hook = deps.store.hooks.get(listener.id!)!;
    let undoError: string | undefined;
    try {
      await context._compensate(`undo:${listener.id}`, async ({ signal }) => {
        const event = makeEvent(
          context,
          input,
          definition!,
          listener.id!,
          failure.cancelled && signal.aborted ? undefined : signal,
          deps.serializer,
        );
        // Use the normal hook admission/interceptor path for compensation too.
        return deps
          .inHook(async () =>
            invokeHook(() =>
              deps.manager.executeHookWithInterceptors(
                {
                  ...hook.hook,
                  run: (emission, dependencies) =>
                    hook.hook.compensate!(
                      result.result,
                      emission,
                      dependencies,
                    ),
                },
                event,
                hook.computedDependencies,
              ),
            ),
          )
          .catch((error: unknown) => {
            undoError = normalizeError(error).message;
            throw error;
          });
      });
    } catch (error) {
      if (
        isDurablePauseInterruptionError(error) ||
        isDurableShutdownInterruptionError(error, runtimeShutdownAbortReason)
      )
        throw error;
      errors.push(undoError ?? normalizeError(error).message);
    }
  }
  if (errors.length) {
    const current = await deps.backend.getExecution(context.executionId);
    if (
      current &&
      (current.status === ExecutionStatus.Running ||
        current.status === ExecutionStatus.Cancelling)
    )
      await deps.backend.saveExecutionIfStatus(
        {
          ...current,
          status: ExecutionStatus.CompensationFailed,
          cancelRequestedAt: undefined,
          error: {
            message:
              failure.failure.message + "; compensation: " + errors.join("; "),
          },
          updatedAt: new Date(),
        },
        [current.status],
      );
    bridgeError(
      "Compensation failed: " +
        failure.failure.message +
        "; " +
        errors.join("; "),
    );
  }
  if (failure.cancelled) {
    const current = await deps.backend.getExecution(context.executionId);
    if (current?.status === ExecutionStatus.Running)
      await deps.backend.saveExecutionIfStatus(
        {
          ...current,
          status: ExecutionStatus.Cancelling,
          cancelRequestedAt: new Date(),
          error: failure.failure,
          updatedAt: new Date(),
        },
        [ExecutionStatus.Running],
      );
  }
  bridgeError(failure.failure.message);
}

function makeEvent(
  context: IDurableContext,
  input: DurableEventInput,
  definition: NonNullable<ReturnType<Store["events"]["get"]>>["event"],
  hookId: string,
  signal: AbortSignal | undefined,
  serializer: Serializer,
) {
  const event = new EventEmissionImpl(
    input.eventId,
    input.eventId,
    deepFreeze(serializer.parse(serializer.stringify(input.data))),
    new Date(input.timestamp),
    signal,
    input.source,
    definition.meta ?? {},
    false,
    definition.tags,
    getDefinitionIdentity(definition),
  );
  const stepKey = JSON.stringify([context.executionId, hookId]);
  Object.assign(event, {
    durable: Object.freeze({
      executionId: context.executionId,
      stepKey,
      compensationKey: JSON.stringify([
        context.executionId,
        hookId,
        "compensate",
      ]),
    }),
    stopPropagation: () =>
      bridgeError("Durable hooks cannot stop propagation."),
  });
  return Object.freeze(event);
}

async function invokeHook<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (
      error instanceof SuspensionSignal ||
      error instanceof ContinuationSignal
    )
      bridgeError(
        "Durable hooks cannot suspend or continue as new; use a workflow task for orchestration.",
      );
    throw error;
  }
}
