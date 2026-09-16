import { durableExecutionInvariantError } from "../../../../errors";
import {
  getDurableWorkflowConcurrency,
  type DurableWorkflowRateLimit,
} from "../../tags/durableWorkflow.tag";
import type { ITask } from "../../../../types/task";
import type { IDurableStore } from "../interfaces/store";
import { TimerStatus, TimerType } from "../types";
import { createExecutionId } from "../utils";
import type { ExecutionLockState } from "./ExecutionManager.locking";
import {
  assertStoreLockOwnership,
  startLockHeartbeat,
} from "./ExecutionManager.locking";

type AnyTask = ITask<any, Promise<any>, any, any, any, any>;

export type WorkflowAdmission =
  | {
      kind: "admitted";
      assertOwnership: () => Promise<void>;
      release: () => Promise<void>;
    }
  | { kind: "deferred"; retryAfterMs: number };

const CONCURRENCY_SLOT_TTL_MS = 30_000;
const CONCURRENCY_RETRY_MS = 100;

/** Coordinates workflow-level admission through distributed store locks. */
export class WorkflowAdmissionController {
  constructor(private readonly store: IDurableStore) {}

  async tryAdmit(params: {
    task: AnyTask;
    workflowKey: string;
    executionLockState: ExecutionLockState;
  }): Promise<WorkflowAdmission> {
    const policy = getDurableWorkflowConcurrency(params.task);
    if (policy === undefined) {
      return {
        kind: "admitted",
        assertOwnership: async () => {},
        release: async () => {},
      };
    }

    if (typeof policy === "number") {
      return await this.tryAcquireConcurrencySlot(
        params.workflowKey,
        policy,
        params.executionLockState,
      );
    }

    return await this.tryAcquireRateLimitSlot(params.workflowKey, policy);
  }

  async defer(executionId: string, retryAfterMs: number): Promise<void> {
    const fireAt = new Date(Date.now() + Math.max(1, retryAfterMs));
    await this.store.createTimer({
      id: `workflow-admission:${executionId}:${createExecutionId()}`,
      executionId,
      type: TimerType.Retry,
      fireAt,
      status: TimerStatus.Pending,
    });
  }

  private async tryAcquireConcurrencySlot(
    workflowKey: string,
    limit: number,
    executionLockState: ExecutionLockState,
  ): Promise<WorkflowAdmission> {
    this.assertConcurrencyLockSupport(workflowKey);

    for (let slot = 0; slot < limit; slot += 1) {
      const resource = this.getSlotResource("concurrency", workflowKey, slot);
      const lockId = await this.store.acquireLock!(
        resource,
        CONCURRENCY_SLOT_TTL_MS,
      );
      if (lockId === null) continue;

      const stopHeartbeat = startLockHeartbeat({
        store: this.store,
        lockResource: resource,
        lockId,
        lockTtlMs: CONCURRENCY_SLOT_TTL_MS,
        lockState: executionLockState,
      });

      return {
        kind: "admitted",
        assertOwnership: async () => {
          // Outcome writes must verify the admission lease as well as the execution lock.
          const slotState = {
            ...executionLockState,
            lockResource: resource,
            lockId,
            lockTtlMs: CONCURRENCY_SLOT_TTL_MS,
          };
          try {
            await assertStoreLockOwnership({
              store: this.store,
              lockState: slotState,
            });
          } finally {
            if (slotState.lost) {
              executionLockState.lost = true;
              executionLockState.lossError = slotState.lossError;
            }
          }
        },
        release: async () => {
          stopHeartbeat();
          try {
            await this.store.releaseLock!(resource, lockId);
          } catch {
            // The lease expiry keeps a failed cleanup conservative and bounded.
          }
        },
      };
    }

    return { kind: "deferred", retryAfterMs: CONCURRENCY_RETRY_MS };
  }

  private async tryAcquireRateLimitSlot(
    workflowKey: string,
    policy: DurableWorkflowRateLimit,
  ): Promise<WorkflowAdmission> {
    this.assertRateLimitLockSupport(workflowKey);

    const now = Date.now();
    const windowStart = Math.floor(now / policy.windowMs) * policy.windowMs;
    const retryAfterMs = Math.max(1, windowStart + policy.windowMs - now);

    for (let slot = 0; slot < policy.max; slot += 1) {
      const resource = this.getSlotResource(
        `rate:${windowStart}`,
        workflowKey,
        slot,
      );
      const lockId = await this.store.acquireLock!(resource, retryAfterMs);
      if (lockId !== null) {
        // Rate slots intentionally expire with the fixed window and are not released.
        return {
          kind: "admitted",
          assertOwnership: async () => {},
          release: async () => {},
        };
      }
    }

    return { kind: "deferred", retryAfterMs };
  }

  private assertConcurrencyLockSupport(workflowKey: string): void {
    if (
      this.store.acquireLock &&
      this.store.renewLock &&
      this.store.releaseLock
    ) {
      return;
    }

    durableExecutionInvariantError.throw({
      message: `Durable workflow '${workflowKey}' configures global concurrency, but its store does not implement acquireLock(), renewLock(), and releaseLock().`,
    });
  }

  private assertRateLimitLockSupport(workflowKey: string): void {
    if (this.store.acquireLock) return;

    durableExecutionInvariantError.throw({
      message: `Durable workflow '${workflowKey}' configures a global rate limit, but its store does not implement acquireLock().`,
    });
  }

  private getSlotResource(
    policy: string,
    workflowKey: string,
    slot: number,
  ): string {
    return `workflow-admission:${policy}:${encodeURIComponent(workflowKey)}:${slot}`;
  }
}
