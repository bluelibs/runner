import { acquireCancellableLease } from "../../../resilience/acquireLease";
import { durableExecutionInvariantError } from "../../../../errors";
import {
  type DurableWorkflowRateLimit,
  type DurableWorkflowConcurrency,
} from "../../tags/durableWorkflow.tag";
import type { IDurableStore } from "../interfaces/store";
import { TimerStatus, TimerType } from "../types";
import { createExecutionId } from "../utils";
import type { ExecutionLockState } from "./ExecutionManager.locking";
import { markExecutionLockLost } from "./ExecutionManager.locking";
import { createRenewableLease } from "../../../resilience/renewableLease";

export type StoreAdmission =
  | {
      kind: "admitted";
      assertOwnership: () => Promise<void>;
      release: () => Promise<void>;
      /** Refuses callback entry after a numeric lease's conservative deadline. */
      assertActive?: () => void;
      /** Exclusive end of the fixed window that granted this allowance. */
      expiresAt?: number;
      /** Stops renewing a numeric permit without freeing capacity before settlement. */
      stopRenewal?: () => void;
    }
  | { kind: "deferred"; retryAfterMs: number };

const CONCURRENCY_SLOT_TTL_MS = 30_000;
const CONCURRENCY_RETRY_MS = 100;

/** Coordinates durable admission through distributed store locks. */
export class StoreAdmissionController {
  constructor(
    private readonly store: IDurableStore,
    private readonly scope: "workflow" | "step",
  ) {}

  async tryAdmit(params: {
    policy: DurableWorkflowConcurrency | undefined;
    key: string;
    executionLockState: ExecutionLockState;
    signal?: AbortSignal;
  }): Promise<StoreAdmission> {
    const policy = params.policy;
    if (policy === undefined) {
      return {
        kind: "admitted",
        assertOwnership: async () => {},
        release: async () => {},
      };
    }

    if (typeof policy === "number") {
      return await this.tryAcquireConcurrencySlot(
        params.key,
        policy,
        params.executionLockState,
        params.signal,
      );
    }

    return await this.tryAcquireRateLimitSlot(
      params.key,
      policy,
      params.signal,
    );
  }

  async defer(executionId: string, retryAfterMs: number): Promise<void> {
    const fireAt = new Date(Date.now() + Math.max(1, retryAfterMs));
    await this.store.createTimer({
      id: `${this.scope}-admission:${executionId}:${createExecutionId()}`,
      executionId,
      type: TimerType.Retry,
      fireAt,
      status: TimerStatus.Pending,
    });
  }

  private async tryAcquireConcurrencySlot(
    key: string,
    limit: number,
    executionLockState: ExecutionLockState,
    signal?: AbortSignal,
  ): Promise<StoreAdmission> {
    this.assertConcurrencyLockSupport(key);

    for (let slot = 0; slot < limit; slot += 1) {
      const resource = this.getSlotResource("concurrency", key, slot);
      const requestedAt = performance.now();
      const lockId = await this.acquireSlot(
        resource,
        CONCURRENCY_SLOT_TTL_MS,
        signal,
      );
      if (lockId === null) continue;

      const ownershipLost = () =>
        markExecutionLockLost(executionLockState, resource);
      const lease = createRenewableLease({
        leaseMs: CONCURRENCY_SLOT_TTL_MS,
        leaseDeadline: requestedAt + CONCURRENCY_SLOT_TTL_MS,
        renew: () =>
          this.store.renewLock!(resource, lockId, CONCURRENCY_SLOT_TTL_MS),
        release: async () => {
          try {
            await this.store.releaseLock!(resource, lockId);
          } catch {
            // Expiry bounds failed cleanup without allowing an unsafe token deletion.
          }
        },
        onLoss: ownershipLost,
        errors: {
          lost: ownershipLost,
          beforeExecution: ownershipLost,
          beforeCompletion: ownershipLost,
          renewal: ownershipLost,
        },
      });
      try {
        lease.assertActive();
      } catch (error) {
        await lease.release();
        throw error;
      }
      return {
        kind: "admitted",
        assertOwnership: async () => {
          if (executionLockState.lost) throw executionLockState.lossError;
          await lease.assertOwnership();
        },
        release: () => lease.release(),
        stopRenewal: lease.stopRenewal,
        assertActive: lease.assertActive,
      };
    }

    return { kind: "deferred", retryAfterMs: CONCURRENCY_RETRY_MS };
  }

  private async tryAcquireRateLimitSlot(
    key: string,
    policy: DurableWorkflowRateLimit,
    signal?: AbortSignal,
  ): Promise<StoreAdmission> {
    this.assertRateLimitLockSupport(key);

    const now = Date.now();
    const windowStart = Math.floor(now / policy.windowMs) * policy.windowMs;
    const windowEnd = windowStart + policy.windowMs;

    for (let slot = 0; slot < policy.max; slot += 1) {
      const resource = this.getSlotResource(`rate:${windowStart}`, key, slot);
      const lockId = await this.acquireSlot(
        resource,
        Math.max(1, windowEnd - Date.now()),
        signal,
        false,
      );
      if (Date.now() >= windowEnd) {
        // A delayed grant belongs to the old window, never to a new callback start.
        return { kind: "deferred", retryAfterMs: 1 };
      }
      if (lockId !== null) {
        // Rate slots intentionally expire with the fixed window and are not released.
        return {
          kind: "admitted",
          assertOwnership: async () => {},
          release: async () => {},
          expiresAt: windowEnd,
        };
      }
    }

    return {
      kind: "deferred",
      retryAfterMs: Math.max(1, windowEnd - Date.now()),
    };
  }

  private async acquireSlot(
    resource: string,
    ttlMs: number,
    signal?: AbortSignal,
    releaseCancelledGrant = true,
  ): Promise<string | null> {
    if (!signal) return await this.store.acquireLock!(resource, ttlMs);
    return await acquireCancellableLease({
      acquire: () => this.store.acquireLock!(resource, ttlMs),
      release: async (lockId) => {
        // Fixed-window starts stay consumed even if cancellation races the grant.
        if (releaseCancelledGrant)
          await this.store.releaseLock!(resource, lockId);
      },
      signal,
    });
  }

  private assertConcurrencyLockSupport(key: string): void {
    if (
      this.store.acquireLock &&
      this.store.renewLock &&
      this.store.releaseLock
    ) {
      return;
    }

    durableExecutionInvariantError.throw({
      message: `Durable ${this.scope} '${key}' configures global concurrency, but its store does not implement acquireLock(), renewLock(), and releaseLock().`,
    });
  }

  private assertRateLimitLockSupport(key: string): void {
    if (this.store.acquireLock) return;

    durableExecutionInvariantError.throw({
      message: `Durable ${this.scope} '${key}' configures a global rate limit, but its store does not implement acquireLock().`,
    });
  }

  private getSlotResource(policy: string, key: string, slot: number): string {
    return `${this.scope}-admission:${policy}:${encodeURIComponent(key)}:${slot}`;
  }
}
