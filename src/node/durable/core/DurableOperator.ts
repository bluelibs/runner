import { IDurableStore } from "./interfaces/store";
import { DurableSignalState, Execution } from "./types";
import type { DurableAuditEntry } from "./audit";
import type { DurableExecutionState, ExecutionStatus } from "./types";
import type { StepResult } from "./types";
import type { ListExecutionsOptions } from "./interfaces/store";
import { encodeExecutionCursor, type ExecutionCursor } from "./executionCursor";
import { toDurableExecutionState } from "./executionIndex";
import {
  durableExecutionInvariantError,
  durableOperatorUnsupportedStoreCapabilityError,
} from "../../../errors";

export { toDurableExecutionState } from "./executionIndex";

/**
 * Filters for dashboard-safe execution listing. Cursor pagination is
 * preferred over `offset` at scale: see `ListExecutionsOptions.cursor`.
 */
export interface ListExecutionStatesOptions {
  /** Restricts results to these execution lifecycle states. */
  status?: ExecutionStatus[];
  /** Restricts results to one registered workflow key. */
  workflowKey?: string;
  /** Exact execution storage identity; avoids an unindexed full-text scan. */
  executionId?: string;
  /** Positive number of rows to return, at most 1000; defaults to 100. */
  limit?: number;
  /**
   * Opaque cursor returned as `nextCursor` by a previous page. When present,
   * `offset` semantics do not apply: the page holds rows strictly after it.
   */
  cursor?: string;
}

/** One page of dashboard-safe execution states. */
export interface ListExecutionStatesPage {
  /** Payload-free execution summaries in canonical listing order. */
  states: DurableExecutionState[];
  /**
   * Cursor for the next page, or `null` when this page is not full (nothing
   * follows). A full final page may still yield one trailing empty page.
   */
  nextCursor: string | null;
}

/**
 * Administrative / operator API for durable workflows.
 *
 * This class is intentionally store-backed and side-effect free with respect to
 * "running" workflows: it lists executions and, when supported by the store,
 * can perform operator actions (retry rollback, skip a step, force fail, patch state).
 *
 * Trust boundary: this class performs no authentication or authorization. It
 * is an internal API for trusted processes (like a database client): enforce
 * tenancy and access control at your lane/edge before calling it, and expose
 * `getExecutionState`/`listExecutionStates` to dashboards rather than the
 * raw `getExecutionDetail`/`listExecutions` paths.
 *
 * Used by dashboards / CLIs / tooling to inspect execution indexes and recover executions.
 */
export class DurableOperator {
  constructor(private readonly store: IDurableStore) {}

  /** Backfills one legacy index batch without blocking the store for a full scan. */
  async rebuildExecutionIndex(
    options: { cursor?: string; limit?: number } = {},
  ): Promise<{ nextCursor: string | null }> {
    if (!this.store.rebuildExecutionIndex) {
      return durableOperatorUnsupportedStoreCapabilityError.throw({
        operation: "rebuildExecutionIndex",
      });
    }
    return this.store.rebuildExecutionIndex(options);
  }

  async listExecutions(options?: ListExecutionsOptions): Promise<Execution[]> {
    return await this.store.listExecutions(options);
  }

  /** Lists executions started directly by the supplied parent execution. */
  async listChildExecutions(
    parentExecutionId: string,
    options: Omit<ListExecutionsOptions, "parentExecutionId"> = {},
  ): Promise<Execution[]> {
    return await this.store.listExecutions({
      ...options,
      parentExecutionId,
    });
  }

  /** Lists retained and queued signal journals for one execution. */
  async listSignals(executionId: string): Promise<DurableSignalState[]> {
    if (!this.store.listSignalStates) {
      durableOperatorUnsupportedStoreCapabilityError.throw({
        operation: "listSignalStates",
      });
    }
    return await this.store.listSignalStates!(executionId);
  }

  /**
   * Reads one execution together with its persisted step results and audit trail.
   *
   * This raw operator path remains useful for dashboards, CLIs, and recovery
   * tooling that need execution detail without binding to a typed task repository.
   */
  async getExecutionDetail(executionId: string): Promise<{
    execution: Execution | null;
    steps: StepResult[];
    audit: DurableAuditEntry[];
  }> {
    const execution = await this.store.getExecution(executionId);
    const steps = await this.store.listStepResults(executionId);
    const audit = this.store.listAuditEntries
      ? await this.store.listAuditEntries(executionId)
      : [];

    return { execution, steps, audit };
  }

  /**
   * Reads the dashboard-safe summary of one execution.
   *
   * Unlike `getExecutionDetail`, the returned state carries no `input`,
   * `result`, or `error` payloads, so it is safe to expose to status pages.
   * Returns `null` when the execution does not exist.
   */
  async getExecutionState(
    executionId: string,
  ): Promise<DurableExecutionState | null> {
    if (this.store.getExecutionState)
      return this.store.getExecutionState(executionId);
    const execution = await this.store.getExecution(executionId);
    return execution ? toDurableExecutionState(execution) : null;
  }

  /**
   * Lists dashboard-safe execution summaries with stable cursor pagination.
   *
   * Prefer `cursor` over offset-style paging at scale: pages stay stable
   * while new executions are created concurrently.
   */
  async listExecutionStates(
    options?: ListExecutionStatesOptions,
  ): Promise<ListExecutionStatesPage> {
    const limit = options?.limit ?? 100;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) {
      durableExecutionInvariantError.throw({
        message: `Durable operator limit must be a positive integer no greater than 1000. Received: ${limit}.`,
      });
    }
    if (options?.executionId !== undefined) {
      if (options.cursor !== undefined) {
        durableExecutionInvariantError.throw({
          message:
            "Exact execution ID lookup cannot be combined with a cursor.",
        });
      }
      const state = await this.getExecutionState(options.executionId);
      const matches =
        state &&
        (!options.workflowKey || state.workflowKey === options.workflowKey) &&
        (!options.status?.length || options.status.includes(state.status));
      return { states: matches ? [state] : [], nextCursor: null };
    }
    const query = {
      status: options?.status,
      workflowKey: options?.workflowKey,
      limit,
      cursor: options?.cursor,
    };
    const states = this.store.listExecutionStates
      ? await this.store.listExecutionStates(query)
      : (await this.store.listExecutions(query)).map(toDurableExecutionState);
    if (states.length < limit) {
      return { states, nextCursor: null };
    }
    const last = states[states.length - 1]!;
    const cursor: ExecutionCursor = {
      createdAt: new Date(last.createdAt).toISOString(),
      id: last.id,
    };
    return { states, nextCursor: encodeExecutionCursor(cursor) };
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
