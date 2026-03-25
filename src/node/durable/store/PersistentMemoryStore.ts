import * as fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { durableStoreShapeError } from "../../../errors";
import { Serializer } from "../../../serializer";
import { MemoryStore, type MemoryStoreSnapshot } from "./MemoryStore";
import type {
  DurableExecutionWaiter,
  DurableSignalState,
  DurableSignalWaiter,
  Execution,
  Schedule,
  StepResult,
  Timer,
} from "../core/types";
import type { DurableAuditEntry } from "../core/audit";

export interface PersistentMemoryStoreConfig {
  /**
   * Local filesystem path used to persist the in-memory durable snapshot.
   *
   * Intended for single-process local/dev scenarios where crash recovery should
   * survive process restarts without provisioning Redis/RabbitMQ.
   */
  filePath: string;
  /**
   * Serializer used to persist and restore the durable snapshot payload.
   *
   * Defaults to Runner's standard serializer when omitted.
   */
  serializer?: Serializer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readArrayField<T>(
  source: Record<string, unknown>,
  fieldName: string,
): T[] {
  const value = source[fieldName];
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return durableStoreShapeError.throw({
      message: `Invalid persistent memory store snapshot: '${fieldName}' must be an array.`,
    });
  }
  return value as T[];
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

/**
 * File-backed variant of `MemoryStore` for local crash-recovery drills.
 *
 * This preserves the memory backend's single-process semantics while making
 * durable store state survive process restarts. It is not intended as a shared
 * multi-process backend.
 */
export class PersistentMemoryStore extends MemoryStore {
  private readonly filePath: string;
  private readonly serializer: Serializer;
  private writeChain: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(config: PersistentMemoryStoreConfig) {
    super();
    this.filePath = resolve(config.filePath);
    this.serializer = config.serializer ?? new Serializer();
  }

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const payload = await fs.readFile(this.filePath, "utf8");
      this.restoreSnapshot(this.parseSnapshot(payload));
    } catch (error) {
      if (isRecord(error) && error.code === "ENOENT") {
        this.initialized = true;
        return;
      }

      throw durableStoreShapeError.new({
        message:
          `Failed to load persistent memory store snapshot from '${this.filePath}'. ` +
          describeError(error),
      });
    }

    this.initialized = true;
  }

  async dispose(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    await this.writeChain;
  }

  protected override async afterDurableMutation(
    snapshot: MemoryStoreSnapshot,
  ): Promise<void> {
    if (!this.initialized) {
      return;
    }

    const payload = this.serializer.serialize(snapshot);
    this.writeChain = this.writeChain.then(
      async () => await this.writeSnapshot(payload),
    );
    await this.writeChain;
  }

  private parseSnapshot(payload: string): MemoryStoreSnapshot {
    const parsed = this.serializer.deserialize<unknown>(payload);
    if (!isRecord(parsed)) {
      return durableStoreShapeError.throw({
        message:
          "Invalid persistent memory store snapshot: expected a top-level object.",
      });
    }

    const version = parsed.version;
    if (version !== 1) {
      return durableStoreShapeError.throw({
        message: `Invalid persistent memory store snapshot: unsupported version '${String(version)}'.`,
      });
    }

    return {
      version: 1,
      executions: readArrayField<Execution>(parsed, "executions"),
      executionIdByIdempotencyKey: readArrayField<readonly [string, string]>(
        parsed,
        "executionIdByIdempotencyKey",
      ),
      stepResults: readArrayField<StepResult>(parsed, "stepResults"),
      signalStates: readArrayField<DurableSignalState>(parsed, "signalStates"),
      signalWaiters: readArrayField<DurableSignalWaiter>(
        parsed,
        "signalWaiters",
      ),
      executionWaiters: readArrayField<DurableExecutionWaiter>(
        parsed,
        "executionWaiters",
      ),
      auditEntries: readArrayField<DurableAuditEntry>(parsed, "auditEntries"),
      timers: readArrayField<Timer>(parsed, "timers"),
      schedules: readArrayField<Schedule>(parsed, "schedules"),
    };
  }

  private async writeSnapshot(payload: string): Promise<void> {
    const directory = dirname(this.filePath);
    const tempFilePath = `${this.filePath}.tmp`;

    await fs.mkdir(directory, { recursive: true });

    try {
      await fs.writeFile(tempFilePath, payload, "utf8");
      await fs.rename(tempFilePath, this.filePath);
    } catch (error) {
      await fs.unlink(tempFilePath).catch(() => undefined);
      throw durableStoreShapeError.new({
        message:
          `Failed to persist memory workflow snapshot to '${this.filePath}'. ` +
          describeError(error),
      });
    }
  }
}
