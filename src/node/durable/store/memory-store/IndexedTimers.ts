import { TimerStatus, type Timer } from "../../core/types";

/** Derived pending-timer membership keeps recovery local to one execution. */
export class IndexedTimers extends Map<string, Timer> {
  private readonly byExecution = new Map<string, Set<string>>();

  override set(id: string, timer: Timer): this {
    this.delete(id);
    super.set(id, timer);
    if (timer.executionId && timer.status === TimerStatus.Pending) {
      const ids = this.byExecution.get(timer.executionId) ?? new Set<string>();
      ids.add(id);
      this.byExecution.set(timer.executionId, ids);
    }
    return this;
  }

  override delete(id: string): boolean {
    const timer = this.get(id);
    if (timer?.executionId) {
      const ids = this.byExecution.get(timer.executionId);
      ids?.delete(id);
      if (ids?.size === 0) this.byExecution.delete(timer.executionId);
    }
    return super.delete(id);
  }

  override clear(): void {
    super.clear();
    this.byExecution.clear();
  }

  forExecution(executionId: string): Timer[] {
    return [...(this.byExecution.get(executionId) ?? [])].map(
      (id) => this.get(id)!,
    );
  }
}
