import type { DurableAuditEntry } from "../../core/audit";
import type { DurableCommandRecord } from "../../core/interfaces/commands";
import type {
  DurableCheckpointBranch,
  DurableHistoryEntry,
  DurableHistoryUpdate,
} from "../../core/interfaces/history";
import type {
  ExpectedExecutionStatuses,
  IDurableStore,
  ListExecutionsOptions,
} from "../../core/interfaces/store";
import type {
  DurableExecutionState,
  Execution,
  StepResult,
  Timer,
  WorkflowState,
} from "../../core/types";
import * as commandOps from "./commands";
import * as executionOps from "./executions";
import * as viewOps from "./executionViews";
import * as historyOps from "./historyAndCheckpoint";
import * as lockOps from "./locks";
import * as retentionOps from "./retention";
import { SqlStoreRuntime } from "./runtime";
import * as timerOps from "./timers";
import type { SqlBackend, SqlStoreBaseConfig } from "./types";

/** Core execution, command, history, view, and retention surface for SQL durable stores. */
export abstract class SqlDurableStoreBase implements Partial<IDurableStore> {
  protected readonly runtime: SqlStoreRuntime;

  constructor(backend: SqlBackend, config: SqlStoreBaseConfig = {}) {
    this.runtime = new SqlStoreRuntime(backend, config);
  }

  async init(): Promise<void> {
    await this.runtime.init();
  }

  async dispose(): Promise<void> {
    await this.runtime.dispose();
  }

  async hasExecutionLease(executionId: string): Promise<boolean> {
    return this.runtime.withoutOwnership(() =>
      lockOps.hasExecutionLease(this.runtime, executionId),
    );
  }

  async createCheckpointExecution(
    branch: DurableCheckpointBranch,
  ): Promise<boolean> {
    return historyOps.createCheckpointExecution(this.runtime, branch);
  }

  async enqueueCommand(
    command: DurableCommandRecord,
  ): Promise<DurableCommandRecord> {
    return commandOps.enqueueCommand(this.runtime, command);
  }

  async rescheduleCommandTimer(
    executionId: string,
    fireAt: Date,
  ): Promise<boolean> {
    return commandOps.rescheduleCommandTimer(this.runtime, executionId, fireAt);
  }

  async getCommand(commandId: string): Promise<DurableCommandRecord | null> {
    return commandOps.getCommand(this.runtime, commandId);
  }

  async getNextCommand(
    executionId: string,
  ): Promise<DurableCommandRecord | null> {
    return commandOps.getNextCommand(this.runtime, executionId);
  }

  async saveCommand(command: DurableCommandRecord): Promise<boolean> {
    return commandOps.saveCommand(this.runtime, command);
  }

  async completeCommand(
    command: DurableCommandRecord,
    expectedExecution?: Execution,
  ): Promise<boolean> {
    return commandOps.completeCommand(this.runtime, command, expectedExecution);
  }

  async recordExecutionHistory(
    executionId: string,
    operation: DurableHistoryUpdate,
  ): Promise<void> {
    await historyOps.recordExecutionHistory(
      this.runtime,
      executionId,
      operation,
    );
  }

  async listExecutionHistory(
    executionId: string,
  ): Promise<DurableHistoryEntry[]> {
    return historyOps.listExecutionHistory(this.runtime, executionId);
  }

  async getExecutionTimers(executionId: string): Promise<Timer[]> {
    return timerOps.getExecutionTimers(this.runtime, executionId);
  }

  async collectCompletedHistory(now: Date, limit: number): Promise<number> {
    return retentionOps.collectCompletedHistory(this.runtime, now, limit);
  }

  async collectExpiredReceipts(now: Date, limit: number): Promise<number> {
    return retentionOps.collectExpiredReceipts(this.runtime, now, limit);
  }

  async saveExecution(execution: Execution): Promise<void> {
    await executionOps.saveExecution(this.runtime, execution);
  }

  async saveExecutionIfStatus(
    execution: Execution,
    expectedStatuses: ExpectedExecutionStatuses,
  ): Promise<boolean> {
    return executionOps.saveExecutionIfStatus(
      this.runtime,
      execution,
      expectedStatuses,
    );
  }

  async getExecution(id: string): Promise<Execution | null> {
    return executionOps.getExecution(this.runtime, id);
  }

  async updateExecution(
    id: string,
    updates: Partial<Execution>,
  ): Promise<void> {
    await executionOps.updateExecution(this.runtime, id, updates);
  }

  async listIncompleteExecutions(): Promise<Execution[]> {
    return executionOps.listIncompleteExecutions(this.runtime);
  }

  async createExecutionWithIdempotencyKey(params: {
    execution: Execution;
    workflowKey: string;
    idempotencyKey: string;
  }): Promise<
    | { created: true; executionId: string }
    | { created: false; executionId: string }
  > {
    return executionOps.createExecutionWithIdempotencyKey(this.runtime, params);
  }

  async createContinuedExecution(params: {
    priorExecution: Execution;
    successorExecution: Execution;
  }): Promise<boolean> {
    return executionOps.createContinuedExecution(this.runtime, params);
  }

  async getWorkflowState<TState = unknown>(
    executionId: string,
  ): Promise<WorkflowState<TState> | null> {
    return viewOps.getWorkflowState<TState>(this.runtime, executionId);
  }

  async saveWorkflowState(state: WorkflowState): Promise<void> {
    await viewOps.saveWorkflowState(this.runtime, state);
  }

  async getExecutionState(
    executionId: string,
  ): Promise<DurableExecutionState | null> {
    return viewOps.getExecutionState(this.runtime, executionId);
  }

  async listExecutions(options?: ListExecutionsOptions): Promise<Execution[]> {
    return viewOps.listExecutions(this.runtime, options);
  }

  async listExecutionStates(
    options: ListExecutionsOptions,
  ): Promise<DurableExecutionState[]> {
    return viewOps.listExecutionStates(this.runtime, options);
  }

  async rebuildExecutionIndex(options: {
    cursor?: string;
    limit?: number;
  }): Promise<{ nextCursor: string | null }> {
    return viewOps.rebuildExecutionIndex(this.runtime, options);
  }

  async listStepResults(executionId: string): Promise<StepResult[]> {
    return viewOps.listStepResults(this.runtime, executionId);
  }

  async appendAuditEntry(entry: DurableAuditEntry): Promise<void> {
    await viewOps.appendAuditEntry(this.runtime, entry);
  }

  async listAuditEntries(
    executionId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<DurableAuditEntry[]> {
    return viewOps.listAuditEntries(this.runtime, executionId, options);
  }

  async listStuckExecutions(): Promise<Execution[]> {
    return executionOps.listStuckExecutions(this.runtime);
  }

  async retryRollback(executionId: string): Promise<void> {
    await executionOps.retryRollback(this.runtime, executionId);
  }

  async forceFail(
    executionId: string,
    error: { message: string; stack?: string },
  ): Promise<void> {
    await executionOps.forceFail(this.runtime, executionId, error);
  }

  async getStepResult(
    executionId: string,
    stepId: string,
  ): Promise<StepResult | null> {
    return viewOps.getStepResult(this.runtime, executionId, stepId);
  }

  async saveStepResult(result: StepResult): Promise<void> {
    await viewOps.saveStepResult(this.runtime, result);
  }

  async skipStep(executionId: string, stepId: string): Promise<void> {
    await this.saveStepResult({
      executionId,
      stepId,
      result: { skipped: true, manual: true },
      completedAt: new Date(),
    });
  }

  async editStepResult(
    executionId: string,
    stepId: string,
    newResult: unknown,
  ): Promise<void> {
    await this.saveStepResult({
      executionId,
      stepId,
      result: newResult,
      completedAt: new Date(),
    });
  }
}
