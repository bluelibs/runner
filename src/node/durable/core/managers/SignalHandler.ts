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
  TimerStatus,
  TimerType,
  isExecutionTerminal,
} from "../types";
import { isMatchError } from "../../../../tools/check";
import { createExecutionId } from "../utils";
import { withSignalLock } from "../signalWaiters";
import {
  durableExecutionInvariantError,
  validationError,
} from "../../../../errors";
import {
  deliverSignalToHop,
  type SignalHopDeps,
} from "./SignalHandler.delivery";

export interface SignalHandlerCallbacks {
  processExecution: (executionId: string) => Promise<void>;
  resolveTask: (
    workflowKey: string,
  ) => ITask<any, Promise<any>, any, any, any, any> | undefined;
}

const isValidationSchema = <TPayload>(
  value: IEventDefinition<TPayload>["payloadSchema"],
): value is IValidationSchema<TPayload> =>
  typeof value === "object" &&
  value !== null &&
  "parse" in value &&
  typeof value.parse === "function";

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
  private readonly hopDeps: SignalHopDeps;

  constructor(
    private readonly store: IDurableStore,
    private readonly auditLogger: AuditLogger,
    logger: Pick<Logger, "warn">,
    private readonly queue: IDurableQueue | undefined,
    private readonly maxAttempts: number,
    private readonly callbacks: SignalHandlerCallbacks,
  ) {
    this.hopDeps = {
      store,
      logger,
      resolveTask: (workflowKey) => callbacks.resolveTask(workflowKey),
    };
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

  async signal<TPayload>(
    executionId: string,
    signal: IEventDefinition<TPayload>,
    payload: TPayload,
  ): Promise<void> {
    const record: DurableSignalRecord<TPayload> = {
      id: createExecutionId(),
      payload: this.validateSignalPayload(signal, payload),
      receivedAt: new Date(),
    };
    await this.deliverAlongChain(executionId, signal.id, record);
  }

  /**
   * Follows the continuation chain so signals addressed to a continued run
   * land on the live tip: each hop reads and delivers under that hop's own
   * signal lock, so the follow decision and the delivery are atomic.
   */
  private async deliverAlongChain(
    executionId: string,
    signalId: string,
    record: DurableSignalRecord,
  ): Promise<void> {
    let hopExecutionId = executionId;
    const visited = new Set<string>();
    for (;;) {
      if (visited.has(hopExecutionId)) {
        return durableExecutionInvariantError.throw({
          message: `Continuation chain for execution '${executionId}' is cyclic at '${hopExecutionId}'.`,
        });
      }
      visited.add(hopExecutionId);

      const outcome = await withSignalLock({
        store: this.store,
        executionId: hopExecutionId,
        signalId,
        fn: async () =>
          await deliverSignalToHop(this.hopDeps, {
            requestedExecutionId: executionId,
            hopExecutionId,
            signalId,
            record,
          }),
      });

      if (outcome.kind === "dropped") return;
      if (outcome.kind === "follow") {
        hopExecutionId = outcome.nextExecutionId;
        continue;
      }
      if (outcome.kind === "stranded") {
        await this.rehomeStrandedSignals(hopExecutionId, signalId);
        return;
      }
      await this.auditAndResume(hopExecutionId, signalId, outcome);
      return;
    }
  }

  /**
   * Re-delivers records left queued on a run that continued after they were
   * buffered. Only the signal that raced the commit can strand records (later
   * signals see the continuation under the lock and follow it). Each record is
   * delivered along the chain before it is dropped from the closed run, so a
   * failure mid-way leaves it parked there instead of deleting it. This is
   * not crash-safe: nothing retries the hand-off, so a record parked by a
   * crash stays undelivered on the closed run (visible in its signal state).
   */
  private async rehomeStrandedSignals(
    closedExecutionId: string,
    signalId: string,
  ): Promise<void> {
    const stranded =
      (await this.store.getSignalState(closedExecutionId, signalId))?.queued ??
      [];
    for (const record of stranded) {
      await this.deliverAlongChain(closedExecutionId, signalId, record);
      await this.store.consumeQueuedSignalRecord(closedExecutionId, signalId);
    }
  }

  private async auditAndResume(
    executionId: string,
    signalId: string,
    delivered: { auditStepId: string; shouldResume: boolean },
  ): Promise<void> {
    const execution = await this.store.getExecution(executionId);
    await this.auditLogger.log({
      kind: DurableAuditEntryKind.SignalDelivered,
      executionId,
      workflowKey: execution?.workflowKey,
      attempt: execution ? execution.attempt : 0,
      stepId: delivered.auditStepId,
      signalId,
    });

    if (!delivered.shouldResume) return;
    if (!execution) return;
    if (isExecutionTerminal(execution.status)) return;

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
