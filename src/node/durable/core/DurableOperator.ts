import { IDurableStore } from "./interfaces/store";
import { Execution } from "./types";
import type { DurableAuditEntry } from "./audit";
import type { StepResult } from "./types";
import type { ListExecutionsOptions } from "./interfaces/store";
import { durableOperatorUnsupportedStoreCapabilityError } from "../../../errors";

/**
 * Administrative / operator API for durable workflows.
 *
 * This class is intentionally store-backed and side-effect free with respect to
 * "running" workflows: it reads execution details and, when supported by the store,
 * can perform operator actions (retry rollback, skip a step, force fail, patch state).
 *
 * Used by dashboards / CLIs / tooling to inspect and recover executions.
 */
export class DurableOperator {
  constructor(private readonly store: IDurableStore) {}

  async listExecutions(options?: ListExecutionsOptions): Promise<Execution[]> {
    if (this.store.listExecutions) {
      return await this.store.listExecutions(options);
    }

    // Fallback for stores that haven't implemented the new method
    return await this.store.listIncompleteExecutions();
  }

  async getExecutionDetail(executionId: string): Promise<{
    execution: Execution | null;
    steps: StepResult[];
    audit: DurableAuditEntry[];
  }> {
    const execution = await this.store.getExecution(executionId);

    const steps = this.store.listStepResults
      ? await this.store.listStepResults(executionId)
      : [];

    const audit = this.store.listAuditEntries
      ? await this.store.listAuditEntries(executionId)
      : [];

    return { execution, steps, audit };
  }

  /**
   * Resets an execution from `compensation_failed` (or other states) to `pending`.
   * This effectively retries the workflow from the last memoized step.
   */
  async retryRollback(executionId: string): Promise<void> {
    if (!this.store.retryRollback) {
      durableOperatorUnsupportedStoreCapabilityError.throw({
        operation: "retryRollback",
      });
    }
    await this.store.retryRollback!(executionId);
  }

  /**
   * Manually marks a step as completed with a specific result.
   * Useful for skipping broken steps or providing a manual fix.
   */
  async skipStep(executionId: string, stepId: string): Promise<void> {
    if (!this.store.skipStep) {
      durableOperatorUnsupportedStoreCapabilityError.throw({
        operation: "skipStep",
      });
    }
    await this.store.skipStep!(executionId, stepId);
  }

  /**
   * Forces an execution to the `failed` state.
   */
  async forceFail(executionId: string, reason: string): Promise<void> {
    if (!this.store.forceFail) {
      durableOperatorUnsupportedStoreCapabilityError.throw({
        operation: "forceFail",
      });
    }
    await this.store.forceFail!(executionId, { message: reason });
  }

  /**
   * Manually patches the result of a step.
   * Useful when a step failed to save its result but the side effect occurred.
   */
  async editState(
    executionId: string,
    stepId: string,
    newState: unknown,
  ): Promise<void> {
    if (!this.store.editStepResult) {
      durableOperatorUnsupportedStoreCapabilityError.throw({
        operation: "editStepResult",
      });
    }
    await this.store.editStepResult!(executionId, stepId, newState);
  }

  /**
   * Lists all executions that require manual intervention.
   */
  async listStuckExecutions(): Promise<Execution[]> {
    if (!this.store.listStuckExecutions) {
      durableOperatorUnsupportedStoreCapabilityError.throw({
        operation: "listStuckExecutions",
      });
    }
    return await this.store.listStuckExecutions!();
  }
}
