import type {
  DurableExecutionWaiter,
  DurableSignalState,
  DurableSignalWaiter,
  Execution,
  Schedule,
  StepResult,
  Timer,
} from "../../core/types";
import type { DurableAuditEntry } from "../../core/audit";
import { Semaphore } from "../../../../models/Semaphore";
import type { DurableMutationResult, MemoryStoreSnapshot } from "./types";

type MemoryStoreDurableMutationHooks = {
  captureSnapshot: () => MemoryStoreSnapshot;
  afterDurableMutation: (snapshot: MemoryStoreSnapshot) => Promise<void>;
};

export class MemoryStoreRuntime {
  executions = new Map<string, Execution>();
  executionIdByIdempotencyKey = new Map<string, string>();
  stepResults = new Map<string, Map<string, StepResult>>();
  signalStates = new Map<string, Map<string, DurableSignalState>>();
  signalWaiters = new Map<
    string,
    Map<string, Map<string, DurableSignalWaiter>>
  >();
  executionWaiters = new Map<string, Map<string, DurableExecutionWaiter>>();
  auditEntries = new Map<string, DurableAuditEntry[]>();
  timers = new Map<string, Timer>();
  schedules = new Map<string, Schedule>();
  locks = new Map<string, { id: string; expires: number }>();
  private readonly signalStateSemaphore = new Semaphore(1);
  private readonly executionWaiterSemaphore = new Semaphore(1);

  constructor(private readonly hooks: MemoryStoreDurableMutationHooks) {}

  async withSignalStatePermit<T>(fn: () => T | Promise<T>): Promise<T> {
    return this.signalStateSemaphore.withPermit(async () => await fn());
  }

  async withExecutionWaiterPermit<T>(fn: () => T | Promise<T>): Promise<T> {
    return this.executionWaiterSemaphore.withPermit(async () => await fn());
  }

  async persistDurableMutation(): Promise<void> {
    await this.hooks.afterDurableMutation(this.hooks.captureSnapshot());
  }

  async withSignalStateMutation<T>(
    fn: () => DurableMutationResult<T> | Promise<DurableMutationResult<T>>,
  ): Promise<T> {
    const { result, snapshot } = await this.withSignalStatePermit(async () => {
      const mutation = await fn();
      return {
        result: mutation.result,
        snapshot: mutation.changed ? this.hooks.captureSnapshot() : null,
      };
    });

    if (snapshot) {
      await this.hooks.afterDurableMutation(snapshot);
    }

    return result;
  }

  async withExecutionWaiterMutation<T>(
    fn: () => DurableMutationResult<T> | Promise<DurableMutationResult<T>>,
  ): Promise<T> {
    const { result, snapshot } = await this.withExecutionWaiterPermit(
      async () => {
        const mutation = await fn();
        return {
          result: mutation.result,
          snapshot: mutation.changed ? this.hooks.captureSnapshot() : null,
        };
      },
    );

    if (snapshot) {
      await this.hooks.afterDurableMutation(snapshot);
    }

    return result;
  }

  pruneExpiredLocks(now: number): void {
    for (const [resource, lock] of this.locks.entries()) {
      if (lock.expires <= now) {
        this.locks.delete(resource);
      }
    }
  }
}
