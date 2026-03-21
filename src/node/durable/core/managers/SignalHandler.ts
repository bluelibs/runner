import type { IDurableStore } from "../interfaces/store";
import type { IDurableQueue } from "../interfaces/queue";
import type { IEventDefinition } from "../../../../types/event";
import type { ITask } from "../../../../types/task";
import type { IValidationSchema } from "../../../../defs";
import type { AuditLogger } from "./AuditLogger";
import { DurableAuditEntryKind } from "../audit";
import {
  type DurableSignalRecord,
  type DurableSignalWaiter,
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
import { withSignalLock } from "../signalWaiters";
import {
  durableExecutionInvariantError,
  validationError,
} from "../../../../errors";

export interface SignalHandlerCallbacks {
  processExecution: (executionId: string) => Promise<void>;
  resolveTask: (
    taskId: string,
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
    private readonly queue: IDurableQueue | undefined,
    private readonly maxAttempts: number,
    private readonly callbacks: SignalHandlerCallbacks,
  ) {}

  private async peekWaitingSignalWaiter(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalWaiter | null> {
    return await this.store.peekNextSignalWaiter(executionId, signalId);
  }

  private async resumeExecutionWithFailsafe(
    executionId: string,
    stepId: string,
  ): Promise<void> {
    if (!this.queue) {
      await this.callbacks.processExecution(executionId);
      return;
    }

    const timerId = `signal_resume:${executionId}:${stepId}`;
    await this.store.createTimer({
      id: timerId,
      executionId,
      type: TimerType.Retry,
      fireAt: new Date(),
      status: TimerStatus.Pending,
    });

    await this.queue.enqueue({
      type: "resume",
      payload: { executionId },
      maxAttempts: this.maxAttempts,
    });

    try {
      await this.store.deleteTimer(timerId);
    } catch {
      // Best-effort timer cleanup; replay/locking keep duplicate resumes safe.
    }
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
      const task = this.callbacks.resolveTask(execution.taskId);
      const declaredSignalIds = task
        ? getDeclaredDurableWorkflowSignalIds(task)
        : null;
      if (declaredSignalIds !== null && !declaredSignalIds.has(signalId)) {
        return durableExecutionInvariantError.throw({
          message: `Signal '${signalId}' is not declared in durableWorkflow.signals for task '${execution.taskId}'.`,
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
        const waiter = await this.peekWaitingSignalWaiter(
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

        completedStepId = waiter.stepId;
        shouldResume = true;

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
        await this.store.saveStepResult({
          executionId,
          stepId: waiter.stepId,
          result: completedSignalState,
          completedAt: new Date(),
        });
        await this.store.appendSignalRecord(
          executionId,
          signalId,
          signalRecord,
        );
        await this.store.deleteSignalWaiter(
          executionId,
          signalId,
          waiter.stepId,
        );

        if (waiterState.timerId ?? waiter.timerId) {
          await this.store.deleteTimer(waiterState.timerId ?? waiter.timerId!);
        }
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
      taskId: execution?.taskId,
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
