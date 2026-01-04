import type { IDurableStore } from "../interfaces/store";
import type { IDurableQueue } from "../interfaces/queue";
import type { IEventDefinition } from "../../../../types/event";
import type { DurableSignalId } from "../ids";
import type { AuditLogger } from "./AuditLogger";
import { isRecord, sleepMs, parseSignalState } from "../utils";

export interface SignalHandlerCallbacks {
  processExecution: (executionId: string) => Promise<void>;
}

/**
 * Handles signal delivery to waiting durable executions.
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
    signal: string | IEventDefinition<TPayload> | DurableSignalId<TPayload>,
    payload: TPayload,
  ): Promise<void> {
    const signalId = typeof signal === "string" ? signal : signal.id;
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
        const isWaitingSignalResult = (
          result: unknown,
        ): result is { state: "waiting"; signalId: string; timerId?: string } => {
          if (!isRecord(result)) return false;
          if (result.state !== "waiting") return false;
          if (typeof result.signalId !== "string") return false;
          if (result.timerId !== undefined) {
            if (typeof result.timerId !== "string") return false;
          }
          return true;
        };

        const waiting = stepResults
          .filter((step) => step.stepId.startsWith("__signal:"))
          .filter((step) => isWaitingSignalResult(step.result))
          .filter((step) => step.result.signalId === signalId)
          .map((step) => ({
            stepId: step.stepId,
            timerId: step.result.timerId,
          }));

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
            throw new Error(
              `Invalid signal step state for '${signalId}' at '${stepId}'`,
            );
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
        throw new Error(
          `Too many signal slots for '${signalId}' (exceeded ${maxSignalSlotsToScan})`,
        );
      }

      await this.store.saveStepResult({
        executionId,
        stepId: completedStepId,
        result: { state: "completed", payload },
        completedAt: new Date(),
      });

      return { completedStepId, shouldResume };
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
        throw new Error(
          `Failed to acquire signal lock for '${signalId}' on execution '${executionId}'`,
        );
      }

      try {
        delivered = await deliver();
      } finally {
        try {
          await this.store.releaseLock!(lockResource, lockId);
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
      kind: "signal_delivered",
      executionId,
      taskId: execution?.taskId,
      attempt,
      stepId: delivered.completedStepId,
      signalId,
    });

    if (!delivered.shouldResume) return;

    if (!execution) return;
    if (
      execution.status === "completed" ||
      execution.status === "failed" ||
      execution.status === "compensation_failed"
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
