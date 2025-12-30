import { IDurableStore } from "./interfaces/store";
import { Execution } from "./types";

export class DurableOperator {
  constructor(private readonly store: IDurableStore) {}

  /**
   * Resets an execution from `compensation_failed` (or other states) to `pending`.
   * This effectively retries the workflow from the last memoized step.
   */
  async retryRollback(executionId: string): Promise<void> {
    if (!this.store.retryRollback) {
      throw new Error("Store does not support retryRollback");
    }
    await this.store.retryRollback(executionId);
  }

  /**
   * Manually marks a step as completed with a specific result.
   * Useful for skipping broken steps or providing a manual fix.
   */
  async skipStep(executionId: string, stepId: string): Promise<void> {
    if (!this.store.skipStep) {
      throw new Error("Store does not support skipStep");
    }
    await this.store.skipStep(executionId, stepId);
  }

  /**
   * Forces an execution to the `failed` state.
   */
  async forceFail(executionId: string, reason: string): Promise<void> {
    if (!this.store.forceFail) {
      throw new Error("Store does not support forceFail");
    }
    await this.store.forceFail(executionId, { message: reason });
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
      throw new Error("Store does not support editStepResult");
    }
    await this.store.editStepResult(executionId, stepId, newState);
  }

  /**
   * Lists all executions that require manual intervention.
   */
  async listStuckExecutions(): Promise<Execution[]> {
    if (!this.store.listStuckExecutions) {
      throw new Error("Store does not support listStuckExecutions");
    }
    return await this.store.listStuckExecutions();
  }
}
