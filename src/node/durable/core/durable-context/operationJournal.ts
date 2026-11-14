import { AsyncLocalStorage } from "node:async_hooks";
import type { IDurableStore } from "../interfaces/store";
import type {
  DurableHistoryKind,
  DurableHistoryUpdate,
} from "../interfaces/history";

/** Runtime-only hook used by the isolated compatibility replayer. */
export interface DurableReplayObserver {
  before(
    operation: Pick<DurableHistoryUpdate, "stepId" | "kind" | "taskKey">,
  ): void;
  after(stepId: string): void;
  effect(): never;
}

/** Captures operation order without changing the public step-result collection. */
export class OperationJournal {
  private readonly parents = new AsyncLocalStorage<string>();
  private origin?: Promise<void>;

  constructor(
    private readonly store: IDurableStore,
    private readonly executionId: string,
    private readonly enabled: boolean,
    readonly replay?: DurableReplayObserver,
  ) {}

  callback<T>(stepId: string, fn: () => Promise<T>): Promise<T> {
    if (this.replay) return this.replay.effect();
    return this.parents.run(stepId, fn);
  }

  async run<T>(
    kind: DurableHistoryKind,
    stepId: string,
    fn: () => Promise<T>,
    taskKey?: string,
  ): Promise<T> {
    this.replay?.before({ kind, stepId, taskKey });
    if (this.enabled && this.store.recordExecutionHistory) {
      this.origin ??= this.recordOrigin();
      await this.origin;
      await this.store.recordExecutionHistory(this.executionId, {
        kind,
        stepId,
        taskKey,
        parentStepId: this.parents.getStore(),
        phase: "started",
      });
    }
    const result = await fn();
    if (this.enabled && this.store.recordExecutionHistory) {
      const state =
        kind === "state"
          ? await this.store.getWorkflowState?.(this.executionId)
          : undefined;
      await this.store.recordExecutionHistory(this.executionId, {
        kind,
        stepId,
        phase: "completed",
        ...(kind === "state"
          ? { stateAfter: state ? { value: state.state } : null }
          : {}),
      });
    }
    this.replay?.after(stepId);
    return result;
  }

  private async recordOrigin(): Promise<void> {
    const state = await this.store.getWorkflowState?.(this.executionId);
    await this.store.recordExecutionHistory!(this.executionId, {
      kind: "origin",
      stepId: "__origin",
      phase: "completed",
      stateAfter: state ? { value: state.state } : null,
    });
  }
}
