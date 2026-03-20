import type { IDurableStore } from "../interfaces/store";
import type { IDurableQueue } from "../interfaces/queue";
import type { IEventDefinition } from "../../../../types/event";
import type { ITask } from "../../../../types/task";
import type { IValidationSchema } from "../../../../defs";
import { Serializer } from "../../../../serializer";
import type { AuditLogger } from "./AuditLogger";
import { DurableAuditEntryKind } from "../audit";
import { requireSignalJournalStore } from "../signalJournal";
import {
  type DurableSignalRecord,
  type DurableSignalWaiter,
  ExecutionStatus,
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

function validateSignalWaiterState(params: {
  signalId: string;
  stepId: string;
  result: unknown;
}): { timerId?: string } {
  const state = parseSignalState(params.result);
  if (!state) {
    return durableExecutionInvariantError.throw({
      message: `Invalid signal step state for '${params.signalId}' at '${params.stepId}'`,
    });
  }

  if (state.signalId !== undefined && state.signalId !== params.signalId) {
    return durableExecutionInvariantError.throw({
      message: `Invalid signal step state for '${params.signalId}' at '${params.stepId}'`,
    });
  }

  if (state.state !== "waiting") {
    return durableExecutionInvariantError.throw({
      message: `Invalid signal waiter state for '${params.signalId}' at '${params.stepId}'`,
    });
  }

  return { timerId: state.timerId };
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
  private readonly serializer = new Serializer();

  constructor(
    private readonly store: IDurableStore,
    private readonly auditLogger: AuditLogger,
    private readonly queue: IDurableQueue | undefined,
    private readonly maxAttempts: number,
    private readonly callbacks: SignalHandlerCallbacks,
  ) {}

  private async takeWaitingSignalWaiter(
    executionId: string,
    signalId: string,
  ): Promise<DurableSignalWaiter | null> {
    return await this.store.takeNextSignalWaiter(executionId, signalId);
  }

  async signal<TPayload>(
    executionId: string,
    signal: IEventDefinition<TPayload>,
    payload: TPayload,
  ): Promise<void> {
    const signalId = signal.id;
    const baseStepId = `__signal:${signalId}`;
    const validatedPayload = this.validateSignalPayload(signal, payload);
    const signalJournalStore = requireSignalJournalStore(
      this.store,
      "signal()",
    );

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
      const serializedPayload = this.serializer.stringify(validatedPayload);

      let completedStepId: string | null = null;
      let shouldResume = false;

      const waiter = await this.takeWaitingSignalWaiter(executionId, signalId);
      if (waiter) {
        const waitingStep = await this.store.getStepResult(
          executionId,
          waiter.stepId,
        );
        if (!waitingStep) {
          return durableExecutionInvariantError.throw({
            message: `Invalid signal step state for '${signalId}' at '${waiter.stepId}'`,
          });
        }

        const { timerId } = validateSignalWaiterState({
          signalId,
          stepId: waiter.stepId,
          result: waitingStep.result,
        });

        completedStepId = waiter.stepId;
        shouldResume = true;
        if (timerId ?? waiter.timerId) {
          await this.store.deleteTimer(timerId ?? waiter.timerId!);
        }
      }

      if (completedStepId) {
        const completedSignalState = shouldPersistStableSignalId(
          completedStepId,
          signalId,
        )
          ? { state: "completed" as const, signalId, payload: validatedPayload }
          : { state: "completed" as const, payload: validatedPayload };
        await this.store.saveStepResult({
          executionId,
          stepId: completedStepId,
          result: completedSignalState,
          completedAt: new Date(),
        });
      }

      await signalJournalStore.appendSignalRecord(
        executionId,
        signalId,
        signalRecord,
      );

      if (!shouldResume) {
        await signalJournalStore.enqueueQueuedSignalRecord(
          executionId,
          signalId,
          {
            ...signalRecord,
            serializedPayload,
          },
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

    if (this.queue) {
      await this.queue.enqueue({
        type: "resume",
        payload: { executionId },
        maxAttempts: this.maxAttempts,
      });
    } else {
      await this.callbacks.processExecution(executionId);
    }
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
