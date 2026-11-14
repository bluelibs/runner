import type { Logger } from "../../../../models/Logger";
import { check, Match } from "../../../../tools/check";
import { durableExecutionInvariantError } from "../../../../errors";
import type { DurableServiceConfig } from "../interfaces/service";
import type { IDurableStore } from "../interfaces/store";
import { encodeExecutionCursor } from "../executionCursor";
import { ExecutionStatus } from "../types";
import { needsClusterRecovery } from "./clusterRecoveryEligibility";

/** Bounded, lifecycle-owned orphan sweeps. Execution leases arbitrate the actual run. */
export class ClusterRecovery {
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private readonly inFlight = new Map<string, Promise<void>>();
  private cursor?: string;
  private stopped = false;
  private readonly interval: number;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly claimTtl: number;

  constructor(
    private readonly store: IDurableStore,
    private readonly config: DurableServiceConfig["recovery"],
    private readonly recover: (id: string) => Promise<void>,
    private readonly knowsWorkflow: (key: string, version?: number) => boolean,
    private readonly logger: Logger,
  ) {
    this.interval = config?.intervalMs ?? 5_000;
    this.batchSize = config?.batchSize ?? 100;
    this.concurrency = config?.concurrency ?? 10;
    this.claimTtl = config?.claimTtlMs ?? 30_000;
    for (const value of [this.interval, this.concurrency, this.claimTtl])
      check(value, Match.Range({ min: 1, integer: true }));
    check(this.batchSize, Match.Range({ min: 1, max: 1000, integer: true }));
    if (
      config?.enabled &&
      (!store.withExecutionOwnership ||
        !store.hasExecutionLease ||
        !store.getExecutionTimers ||
        !store.listExecutionStates ||
        !store.acquireLock ||
        !store.renewLock ||
        !store.releaseLock)
    ) {
      durableExecutionInvariantError.throw({
        message:
          "Continuous durable recovery requires atomic execution ownership, lease inspection, execution timer and metadata indexes, and renewable store locks.",
      });
    }
  }

  start(): void {
    if (!this.config?.enabled || this.timer || this.stopped) return;
    this.timer = setInterval(() => this.tick(), this.interval);
    this.timer.unref();
    this.tick();
  }

  private tick(): void {
    if (this.active || this.stopped) return;
    this.active = this.sweep()
      .catch((error) => this.report(error))
      .finally(() => {
        this.active = undefined;
      });
  }

  private async sweep(): Promise<void> {
    if (this.inFlight.size >= this.concurrency) return;
    const rows = await this.store.listExecutionStates!({
      status: [
        ExecutionStatus.Pending,
        ExecutionStatus.Running,
        ExecutionStatus.Retrying,
        ExecutionStatus.Sleeping,
        ExecutionStatus.Cancelling,
      ],
      limit: this.batchSize,
      cursor: this.cursor,
    });
    // Advance only past inspected rows so a full admission window cannot starve a page.
    for (const row of rows) {
      if (this.stopped || this.inFlight.size >= this.concurrency) return;
      this.cursor = encodeExecutionCursor({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
      });
      if (
        !this.knowsWorkflow(row.workflowKey, row.workflowVersion) ||
        this.inFlight.has(row.id)
      )
        continue;
      const pending = this.recoverCandidate(row.id)
        .catch((error) => this.report(error))
        .finally(() => {
          this.inFlight.delete(row.id);
        });
      this.inFlight.set(row.id, pending);
    }
    if (rows.length < this.batchSize) this.cursor = undefined;
  }

  private async recoverCandidate(id: string): Promise<void> {
    if (await this.store.hasExecutionLease!(id)) return;
    const resource = `recovery:execution:${id}`;
    const claim = await this.store.acquireLock!(resource, this.claimTtl);
    if (claim === null) return;
    let submitted = false;
    try {
      if (this.stopped || (await this.store.hasExecutionLease!(id))) return;
      const execution = await this.store.getExecution(id);
      if (
        !execution ||
        !this.knowsWorkflow(execution.workflowKey, execution.workflowVersion) ||
        !(await needsClusterRecovery(this.store, execution)) ||
        this.stopped
      )
        return;
      await this.recover(id);
      // Keep successful dispatch claims until expiry: queues may not deliver immediately.
      submitted = true;
    } finally {
      if (!submitted) await this.store.releaseLock!(resource, claim);
    }
  }

  private async report(error: unknown): Promise<void> {
    await this.logger
      .error("Durable cluster recovery failed.", { error })
      .catch(() => undefined);
  }

  cooldown(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async stop(): Promise<void> {
    this.cooldown();
    await this.active;
    await Promise.all(this.inFlight.values());
  }
}
