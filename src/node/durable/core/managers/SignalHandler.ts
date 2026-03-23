import type { IDurableStore } from "../interfaces/store";
import type { IDurableQueue } from "../interfaces/queue";
import type { IEventDefinition } from "../../../../types/event";
import type { ITask } from "../../../../types/task";
import type { IValidationSchema } from "../../../../defs";
import type { AuditLogger } from "./AuditLogger";
import type { Logger } from "../../../../models/Logger";
import { DurableAuditEntryKind } from "../audit";
import {
  type DurableSignalRecord,
  ExecutionStatus,
  TimerStatus,
  TimerType,
} from "../types";
import { getDeclaredDurableWorkflowSignalIds } from "../../tags/durableWorkflow.tag";
import { isMatchError } from "../../../../tools/check";
import {
  createExecutionId,
  shouldPersistStableSignalId,
  parseSignalState,
} from "../utils";
import { clearExecutionCurrentIfSuspendedOnStep } from "../current";
import { withSignalLock } from "../signalWaiters";
import {
  commitDurableWaitCompletion,
  runBestEffortCleanup,
} from "../waiterCore";
import {
  durableExecutionInvariantError,
  validationError,
} from "../../../../errors";

export interface SignalHandlerCallbacks {
  processExecution: (executionId: string) => Promise<void>;
  resolveTask: (
    workflowKey: string,
  ) => ITask<any, Promise<any>, any, any, any, any> | undefined;
}

const isTerminalExecutionStatus = (status: ExecutionStatus): boolean =>
  status === ExecutionStatus.Completed ||
  status === ExecutionStatus.Failed ||
  status === ExecutionStatus.CompensationFailed ||
  status === ExecutionStatus.Cancelled;

const isValidationSchema = <TPayload>(
  value: IEventDefinition<TPayload>["payloadSchema"],
): value is IValidationSchema<TPayload> =>
  typeof value === "object" &&
  value !== null &&
  "parse" in value &&
  typeof value.parse === "function";

function inspectSignalWaiterState(params: {
  signalId: string;
  stepId: string;
  result: unknown;
}): { kind: "stale" } | { kind: "waiting"; timerId?: string } {
  const state = parseSignalState(params.result);
  if (!state) {
    return { kind: "stale" };
  }

  if (state.signalId !== undefined && state.signalId !== params.signalId) {
    return { kind: "stale" };
  }

  if (state.state !== "waiting") {
    return { kind: "stale" };
  }

  return { kind: "waiting", timerId: state.timerId };
}

/**
 * Delivers external signals to durable executions waiting in `DurableContext.waitForSignal()`.
 *
 * Signal delivery is store-centric:
 * - find the earliest waiting signal step for the given `signalId`
 * - persist a "completed" signal payload into the step result
 * - optionally clean up timeout timers
 * - trigger execution resumption (queue message or direct processing)
 */
export class SignalHandler {
  constructor(
    private readonly store: IDurableStore,
    private readonly auditLogger: AuditLogger,
    private readonly logger: Pick<Logger, "warn">,
    private readonly queue: IDurableQueue | undefined,
    private readonly maxAttempts: number,
    private readonly callbacks: SignalHandlerCallbacks,
  ) {}

  private async clearSignalWaitCurrentBestEffort(params: {
    executionId: string;
    stepId: string;
    signalId: string;
  }): Promise<void> {
    try {
      await clearExecutionCurrentIfSuspendedOnStep(
        this.store,
        params.executionId,
        {
          stepId: params.stepId,
          kinds: ["waitForSignal"],
        },
      );
    } catch (error) {
      try {
        await this.logger.warn(
          "Durable waitForSignal current cleanup failed; resuming execution anyway.",
          {
            executionId: params.executionId,
            stepId: params.stepId,
            signalId: params.signalId,
            error,
          },
        );
      } catch {
        // Logging must stay best-effort here.
      }
    }
  }

  private async resumeExecutionWithFailsafe(
    executionId: string,
    stepId: string,
  ): Promise<void> {
    const timerId = `signal_resume:${executionId}:${stepId}`;
    await this.store.createTimer({
      id: timerId,
      executionId,
      type: TimerType.Retry,
      fireAt: new Date(),
      status: TimerStatus.Pending,
    });

    if (this.queue) {
      await this.queue.enqueue({
        type: "resume",
        payload: { executionId },
        maxAttempts: this.maxAttempts,
      });
    } else {
      await this.callbacks.processExecution(executionId);
    }

    try {
      await this.store.deleteTimer(timerId);
    } catch {
      // Best-effort timer cleanup; replay/locking keep duplicate resumes safe.
    }
  }

  private async finalizeDeliveredSignal(params: {
    executionId: string;
    signalId: string;
    stepId: string;
    signalRecord: DurableSignalRecord;
  }): Promise<void> {
    await runBestEffortCleanup(() =>
      this.store.appendSignalRecord(
        params.executionId,
        params.signalId,
        params.signalRecord,
      ),
    );
    await runBestEffortCleanup(() =>
      this.store.deleteSignalWaiter(
        params.executionId,
        params.signalId,
        params.stepId,
      ),
    );
  }

  private async commitDeliveredSignal(params: {
    executionId: string;
    signalId: string;
    stepId: string;
    completedSignalState: Record<string, unknown>;
    signalRecord: DurableSignalRecord;
    timerId?: string;
  }): Promise<boolean> {
    const stepResult = {
      executionId: params.executionId,
      stepId: params.stepId,
      result: params.completedSignalState,
      completedAt: new Date(),
    };

    return await commitDurableWaitCompletion({
      store: this.store,
      stepResult,
      timerId: params.timerId,
      commitAtomically: this.store.commitSignalDelivery
        ? async () =>
            await this.store.commitSignalDelivery!({
              executionId: params.executionId,
              signalId: params.signalId,
              stepId: params.stepId,
              stepResult,
              signalRecord: params.signalRecord,
              timerId: params.timerId,
            })
        : undefined,
      onFallbackCommitted: async () => {
        await this.finalizeDeliveredSignal({
          executionId: params.executionId,
          signalId: params.signalId,
          stepId: params.stepId,
          signalRecord: params.signalRecord,
        });
      },
    });
  }

  async signal<TPayload>(
    executionId: string,
    signal: IEventDefinition<TPayload>,
    payload: TPayload,
  ): Promise<void> {
    const signalId = signal.id;
    const baseStepId = `__signal:${signalId}`;
    const validatedPayload = this.validateSignalPayload(signal, payload);

    const deliver = async (): Promise<{
      auditStepId: string;
      shouldResume: boolean;
    } | null> => {
      const execution = await this.store.getExecution(executionId);
      if (!execution) return null;
      if (isTerminalExecutionStatus(execution.status)) return null;
      const workflowKey = execution.workflowKey;
      const task = this.callbacks.resolveTask(workflowKey);
      const declaredSignalIds = task
        ? getDeclaredDurableWorkflowSignalIds(task)
        : null;
      if (declaredSignalIds !== null && !declaredSignalIds.has(signalId)) {
        return durableExecutionInvariantError.throw({
          message: `Signal '${signalId}' is not declared in durableWorkflow.signals for workflow '${workflowKey}'.`,
        });
      }

      const signalRecord: DurableSignalRecord<TPayload> = {
        id: createExecutionId(),
        payload: validatedPayload,
        receivedAt: new Date(),
      };

      let completedStepId: string | null = null;
      let shouldResume = false;

      while (true) {
        const waiter = await this.store.peekNextSignalWaiter(
          executionId,
          signalId,
        );
        if (!waiter) {
          break;
        }

        const waitingStep = await this.store.getStepResult(
          executionId,
          waiter.stepId,
        );
        if (!waitingStep) {
          await this.store.deleteSignalWaiter(
            executionId,
            signalId,
            waiter.stepId,
          );
          continue;
        }

        const waiterState = inspectSignalWaiterState({
          signalId,
          stepId: waiter.stepId,
          result: waitingStep.result,
        });
        if (waiterState.kind === "stale") {
          await this.store.deleteSignalWaiter(
            executionId,
            signalId,
            waiter.stepId,
          );
          continue;
        }

        const completedSignalState = shouldPersistStableSignalId(
          waiter.stepId,
          signalId,
        )
          ? {
              state: "completed" as const,
              signalId,
              payload: validatedPayload,
            }
          : { state: "completed" as const, payload: validatedPayload };
        const committed = await this.commitDeliveredSignal({
          executionId,
          signalId,
          stepId: waiter.stepId,
          completedSignalState,
          signalRecord,
          timerId: waiterState.timerId ?? waiter.timerId,
        });
        if (!committed) {
          continue;
        }
        await this.clearSignalWaitCurrentBestEffort({
          executionId,
          signalId,
          stepId: waiter.stepId,
        });
        completedStepId = waiter.stepId;
        shouldResume = true;
        break;
      }

      if (!shouldResume) {
        await this.store.bufferSignalRecord(
          executionId,
          signalId,
          signalRecord,
        );
      }

      return {
        auditStepId: completedStepId ?? baseStepId,
        shouldResume,
      };
    };

    const delivered = await withSignalLock({
      store: this.store,
      executionId,
      signalId,
      fn: deliver,
    });

    if (!delivered) return;

    const execution = await this.store.getExecution(executionId);
    const attempt = execution ? execution.attempt : 0;
    await this.auditLogger.log({
      kind: DurableAuditEntryKind.SignalDelivered,
      executionId,
      workflowKey: execution?.workflowKey,
      attempt,
      stepId: delivered.auditStepId,
      signalId,
    });

    if (!delivered.shouldResume) return;

    if (!execution) return;
    if (isTerminalExecutionStatus(execution.status)) return;

    await this.resumeExecutionWithFailsafe(executionId, delivered.auditStepId);
  }

  private validateSignalPayload<TPayload>(
    signal: IEventDefinition<TPayload>,
    payload: TPayload,
  ): TPayload {
    if (!isValidationSchema(signal.payloadSchema)) {
      return payload;
    }

    try {
      return signal.payloadSchema.parse(payload);
    } catch (error) {
      if (isMatchError(error)) {
        throw error;
      }

      return validationError.throw({
        subject: "Signal payload",
        id: signal.id,
        originalError:
          error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
}
