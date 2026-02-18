import type { IDurableStore } from "../interfaces/store";
import type { IDurableQueue } from "../interfaces/queue";
import type { IEventDefinition } from "../../../../types/event";
import type { AuditLogger } from "./AuditLogger";
import { DurableAuditEntryKind } from "../audit";
import { ExecutionStatus } from "../types";
import { isRecord, sleepMs, parseSignalState } from "../utils";
import { durableExecutionInvariantError } from "../../../../errors";

export interface SignalHandlerCallbacks {
  processExecution: (executionId: string) => Promise<void>;
}

type WaitingSignalResult = {
  state: "waiting";
  signalId: string;
  timerId?: string;
};

const isWaitingSignalStep = (step: {
  stepId: string;
  result: unknown;
}): step is { stepId: string; result: WaitingSignalResult } => {
  const result = step.result;
  if (!isRecord(result)) return false;
  const waitResult = result as WaitingSignalResult;
  if (waitResult.state !== "waiting") return false;
  if (typeof waitResult.signalId !== "string") return false;
  if (waitResult.timerId !== undefined) {
    if (typeof waitResult.timerId !== "string") return false;
  }
  return true;
};

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

  async signal<TPayload>(
    executionId: string,
    signal: IEventDefinition<TPayload>,
    payload: TPayload,
  ): Promise<void> {
    const signalId = signal.id;
    const baseStepId = `__signal:${signalId}`;

    const maxSignalSlotsToScan = 1000;

    const deliver = async (): Promise<{
      completedStepId: string;
      shouldResume: boolean;
    }> => {
      let completedStepId: string | null = null;
      let shouldResume = false;

      const stepResults = await this.store.listStepResults?.(executionId);
      if (stepResults) {
        const waiting: Array<{ stepId: string; timerId?: string }> = [];
        for (const step of stepResults) {
          if (
            step.stepId.startsWith("__signal:") &&
            isWaitingSignalStep(step) &&
            step.result.signalId === signalId
          ) {
            waiting.push({
              stepId: step.stepId,
              timerId: step.result.timerId,
            });
          }
        }

        if (waiting.length > 0) {
          const pickKey = (stepId: string) => {
            if (stepId === baseStepId) {
              return { group: 0, index: 0, stepId };
            }
            if (stepId.startsWith(`${baseStepId}:`)) {
              const index = Number(stepId.slice(baseStepId.length + 1));
              if (Number.isFinite(index)) {
                return { group: 1, index, stepId };
              }
            }
            return { group: 2, index: 0, stepId };
          };

          const compareKey = (
            a: ReturnType<typeof pickKey>,
            b: ReturnType<typeof pickKey>,
          ): number => {
            if (a.group !== b.group) return a.group - b.group;
            if (a.group === 1) {
              if (a.index !== b.index) return a.index - b.index;
            }
            return a.stepId.localeCompare(b.stepId);
          };

          let best = waiting[0];
          let bestKey = pickKey(best.stepId);

          for (let index = 1; index < waiting.length; index += 1) {
            const candidate = waiting[index];
            const candidateKey = pickKey(candidate.stepId);
            if (compareKey(candidateKey, bestKey) < 0) {
              best = candidate;
              bestKey = candidateKey;
            }
          }

          completedStepId = best.stepId;
          shouldResume = true;
          if (best.timerId) {
            await this.store.deleteTimer(best.timerId);
          }
        }
      }

      if (!completedStepId) {
        for (let index = 0; index < maxSignalSlotsToScan; index += 1) {
          const stepId = index === 0 ? baseStepId : `${baseStepId}:${index}`;
          const existing = await this.store.getStepResult(executionId, stepId);

          if (!existing) {
            completedStepId = stepId;
            break;
          }

          const state = parseSignalState(existing.result);
          if (!state) {
            return durableExecutionInvariantError.throw({
              message: `Invalid signal step state for '${signalId}' at '${stepId}'`,
            });
          }

          if (state.state === "waiting") {
            if (state.timerId) {
              await this.store.deleteTimer(state.timerId);
            }
            completedStepId = stepId;
            shouldResume = true;
            break;
          }

          // completed / timed_out -> keep scanning for the next available slot
        }
      }

      if (!completedStepId) {
        return durableExecutionInvariantError.throw({
          message: `Too many signal slots for '${signalId}' (exceeded ${maxSignalSlotsToScan})`,
        });
      }

      await this.store.saveStepResult({
        executionId,
        stepId: completedStepId,
        result: { state: "completed", payload },
        completedAt: new Date(),
      });

      return { completedStepId: completedStepId!, shouldResume };
    };

    let delivered: { completedStepId: string; shouldResume: boolean };
    const canLock = this.store.acquireLock && this.store.releaseLock;
    if (canLock) {
      const lockResource = `signal:${executionId}:${signalId}`;
      const lockTtlMs = 10_000;
      const maxLockAttempts = 20;

      let lockId: string | null = null;
      for (let attempt = 0; attempt < maxLockAttempts; attempt += 1) {
        lockId = await this.store.acquireLock!(lockResource, lockTtlMs);
        if (lockId !== null) break;
        await sleepMs(5);
      }

      if (lockId === null) {
        return durableExecutionInvariantError.throw({
          message: `Failed to acquire signal lock for '${signalId}' on execution '${executionId}'`,
        });
      }

      try {
        delivered = await deliver();
      } finally {
        try {
          await this.store.releaseLock!(lockResource, lockId!);
        } catch {
          // best-effort cleanup; ignore
        }
      }
    } else {
      delivered = await deliver();
    }

    const execution = await this.store.getExecution(executionId);
    const attempt = execution ? execution.attempt : 0;
    await this.auditLogger.log({
      kind: DurableAuditEntryKind.SignalDelivered,
      executionId,
      taskId: execution?.taskId,
      attempt,
      stepId: delivered.completedStepId,
      signalId,
    });

    if (!delivered.shouldResume) return;

    if (!execution) return;
    if (
      execution.status === ExecutionStatus.Completed ||
      execution.status === ExecutionStatus.Failed ||
      execution.status === ExecutionStatus.CompensationFailed ||
      execution.status === ExecutionStatus.Cancelled
    )
      return;

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
}
