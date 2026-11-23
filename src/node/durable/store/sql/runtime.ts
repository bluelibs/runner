import { AsyncLocalStorage } from "node:async_hooks";
import { Serializer } from "../../../../serializer";
import { durableExecutionInvariantError } from "../../../../errors";
import { toDurableExecutionState } from "../../core/executionIndex";
import type { DurableExecutionOwnership } from "../../core/interfaces/ownership";
import {
  collectionDeadline,
  receiptExpiryDeadline,
} from "../../core/retention";
import type { Execution } from "../../core/types";
import { createSchemaStatements } from "./schema";
import {
  forUpdate,
  nowMsSql,
  type SqlBackend,
  type SqlExecutor,
  type SqlStoreBaseConfig,
} from "./types";

/** Shared execution/ownership runtime coordinated across all SQL durable modules. */
export class SqlStoreRuntime {
  readonly namespace: string;
  readonly serializer: Serializer;
  private readonly autoCreateTables: boolean;
  private readonly ownership =
    new AsyncLocalStorage<DurableExecutionOwnership>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private disposed = false;

  constructor(
    readonly backend: SqlBackend,
    config: SqlStoreBaseConfig,
  ) {
    this.namespace = config.namespace ?? "default";
    this.serializer = config.serializer ?? new Serializer();
    this.autoCreateTables = config.autoCreateTables ?? true;
  }

  /** Initializes schema idempotently; concurrent callers await the same initialization. */
  async init(): Promise<void> {
    this.disposed = false;
    if (this.initialized) return;
    if (!this.initPromise) {
      this.initPromise = this.backend
        .init(createSchemaStatements(this.backend.dialect))
        .then(() => {
          this.initialized = true;
        })
        .finally(() => {
          this.initPromise = null;
        });
    }
    await this.initPromise;
  }

  /** Releases backend resources if owned and clears initialized flag. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.initialized = false;
    await this.backend.dispose();
  }

  private async ensureReady(): Promise<void> {
    if (this.disposed) {
      durableExecutionInvariantError.throw({
        message: "Cannot access SQL durable store after dispose().",
      });
    }
    if (this.initialized) return;
    if (!this.autoCreateTables) {
      durableExecutionInvariantError.throw({
        message:
          "SQL durable store is not initialized. Call store.init() before use when autoCreateTables is false.",
      });
    }
    await this.init();
  }

  withOwnership<T>(
    ownership: DurableExecutionOwnership,
    operation: () => T,
  ): T {
    return this.ownership.run(ownership, operation);
  }

  withoutOwnership<T>(operation: () => T): T {
    return this.ownership.exit(operation);
  }

  /** Enforces active execution lease inside the current transaction when call-scoped. */
  async assertOwnershipInTx(tx: SqlExecutor): Promise<void> {
    const owner = this.ownership.getStore();
    if (!owner) return;
    const now = nowMsSql(tx.dialect);
    const row = await tx.get<{
      lock_id: string;
      active: boolean | number;
    }>(
      `SELECT lock_id, (expires_at_ms > ${now.expr}) AS active FROM runner_durable_locks WHERE namespace = ? AND resource = ?${forUpdate(tx.dialect)}`,
      [...now.params, this.namespace, `execution:${owner.executionId}`],
    );
    if (!row || row.lock_id !== owner.lockId || !row.active) {
      owner.onLost();
    }
  }

  async withRead<T>(operation: (exec: SqlExecutor) => Promise<T>): Promise<T> {
    await this.ensureReady();
    return operation(this.backend);
  }

  async withWriteTx<T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    await this.ensureReady();
    return this.backend.transaction(async (tx) => {
      await this.assertOwnershipInTx(tx);
      return operation(tx);
    });
  }

  async withRawTx<T>(operation: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    await this.ensureReady();
    return this.backend.transaction(operation);
  }

  stringify(value: unknown): string {
    return this.serializer.stringify(value);
  }

  parse<T>(raw: unknown): T {
    return this.serializer.parse<T>(String(raw));
  }

  encodeExecutionRow(execution: Execution) {
    return {
      namespace: this.namespace,
      id: execution.id,
      workflowKey: execution.workflowKey,
      parentExecutionId: execution.parentExecutionId ?? null,
      status: execution.status,
      createdAtMs: execution.createdAt.getTime(),
      historyDeadlineMs: collectionDeadline(execution) ?? null,
      receiptDeadlineMs: receiptExpiryDeadline(execution) ?? null,
      payload: this.stringify(execution),
      statePayload: this.stringify(toDurableExecutionState(execution)),
    };
  }
}
