import type { ITask } from "../../../../types/task";
import { check, Match } from "../../../../tools/check";
import { durableExecutionInvariantError } from "../../../../errors";

/**
 * In-memory durable task registry.
 *
 * Durable executions persist only a `workflowKey` in the store, so the runtime needs a way
 * to resolve `workflowKey -> ITask` when resuming. This registry holds tasks that
 * were registered on the current process and optionally delegates to an external
 * resolver for tasks defined elsewhere (useful for modular apps).
 */
export class TaskRegistry {
  private readonly tasks = new Map<
    string,
    ITask<any, Promise<any>, any, any, any, any>
  >();

  constructor(
    private readonly externalResolver?: (
      workflowKey: string,
    ) => ITask<any, Promise<any>, any, any, any, any> | undefined,
    private readonly workflowKeyResolver?: (
      task: ITask<any, Promise<any>, any, any, any, any>,
    ) => string | undefined,
  ) {}

  register<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
  ): void {
    const workflowKey = this.getWorkflowKey(task);
    try {
      check(workflowKey, Match.NonEmptyString);
    } catch {
      durableExecutionInvariantError.throw({
        message: `Task '${task.id}' resolved to an empty durable workflow key.`,
      });
    }

    const existing = this.tasks.get(workflowKey);
    if (existing && existing.id !== task.id) {
      durableExecutionInvariantError.throw({
        message: `Durable workflow key '${workflowKey}' is already registered for task '${existing.id}' and cannot be reused by '${task.id}'.`,
      });
    }

    this.tasks.set(task.id, task);
    if (workflowKey !== task.id) {
      this.tasks.set(workflowKey, task);
    }
  }

  find(
    workflowKey: string,
  ): ITask<any, Promise<any>, any, any, any, any> | undefined {
    return this.tasks.get(workflowKey) ?? this.externalResolver?.(workflowKey);
  }

  /**
   * Returns the durable workflow key used when storing and resuming a task.
   *
   * `ScheduleManager` and `PollingManager` should persist this value, not the
   * local `task.id`, so scheduled durable executions can resolve the same task
   * identity across composed runtimes and compatibility aliases.
   *
   * @param task The registered task whose durable storage identity is needed.
   * @returns The stable workflow key written into durable execution state.
   */
  getWorkflowKey(task: ITask<any, Promise<any>, any, any, any, any>): string {
    return this.workflowKeyResolver?.(task) ?? task.id;
  }
}
