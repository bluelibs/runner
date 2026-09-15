import type { DurableExecutionState, Execution } from "../../core/types";
import type { ListExecutionsOptions } from "../../core/interfaces/store";
import {
  executionIndexMember,
  executionIndexPartitions,
  executionQueryAfter,
  executionQueryPartitions,
  executionQueryLimit,
  toDurableExecutionState,
} from "../../core/executionIndex";
import { OrderedKeys } from "./OrderedKeys";

/** Write-through index, owned by one store and rebuilt when restoring a snapshot. */
export class IndexedExecutions extends Map<string, Execution> {
  private readonly partitions = new Map<string, OrderedKeys>();
  private readonly states = new Map<string, DurableExecutionState>();

  override set(id: string, execution: Execution): this {
    const previous = this.get(id);
    const member = executionIndexMember(execution);
    const state = toDurableExecutionState(execution);
    if (
      previous &&
      executionIndexMember(previous) === member &&
      previous.status === execution.status &&
      previous.workflowKey === execution.workflowKey
    ) {
      this.states.set(member, state);
      return super.set(id, execution);
    }
    if (previous) this.removeFromIndex(previous);
    this.states.set(member, state);
    for (const partition of executionIndexPartitions(state)) {
      let index = this.partitions.get(partition);
      if (!index) this.partitions.set(partition, (index = new OrderedKeys()));
      index.add(member);
    }
    return super.set(id, execution);
  }

  private removeFromIndex(execution: Execution): void {
    const member = executionIndexMember(execution);
    this.states.delete(member);
    for (const partition of executionIndexPartitions(execution)) {
      this.partitions.get(partition)!.delete(member);
    }
  }

  override delete(id: string): boolean {
    const execution = this.get(id);
    if (execution) this.removeFromIndex(execution);
    return super.delete(id);
  }

  override clear(): void {
    this.partitions.clear();
    this.states.clear();
    super.clear();
  }

  listStates(options: ListExecutionsOptions): DurableExecutionState[] {
    const limit = executionQueryLimit(options);
    const after = executionQueryAfter(options);
    const members = executionQueryPartitions(options)
      .flatMap(
        (partition) => this.partitions.get(partition)?.page(after, limit) ?? [],
      )
      .sort()
      .slice(0, limit);
    return members.map((member) => structuredClone(this.states.get(member)!));
  }
}
