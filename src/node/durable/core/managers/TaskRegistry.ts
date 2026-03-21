import type { ITask } from "../../../../types/task";
import { check, Match } from "../../../../tools/check";
import { durableExecutionInvariantError } from "../../../../errors";

/**
 * In-memory durable task registry.
 *
 * Durable executions persist only a `taskId` in the store, so the runtime needs a way
 * to resolve `taskId -> ITask` when resuming. This registry holds tasks that
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
      taskId: string,
    ) => ITask<any, Promise<any>, any, any, any, any> | undefined,
    private readonly persistenceIdResolver?: (
      task: ITask<any, Promise<any>, any, any, any, any>,
    ) => string | undefined,
  ) {}

  register<TInput, TResult>(
    task: ITask<TInput, Promise<TResult>, any, any, any, any>,
  ): void {
    const persistenceId = this.getPersistenceId(task);
    try {
      check(persistenceId, Match.NonEmptyString);
    } catch {
      durableExecutionInvariantError.throw({
        message: `Task '${task.id}' resolved to an empty durable persistence id.`,
      });
    }

    const existing = this.tasks.get(persistenceId);
    if (existing && existing.id !== task.id) {
      durableExecutionInvariantError.throw({
        message: `Durable persistence id '${persistenceId}' is already registered for task '${existing.id}' and cannot be reused by '${task.id}'.`,
      });
    }

    this.tasks.set(task.id, task);
    if (persistenceId !== task.id) {
      this.tasks.set(persistenceId, task);
    }
  }

  find(
    taskId: string,
  ): ITask<any, Promise<any>, any, any, any, any> | undefined {
    return this.tasks.get(taskId) ?? this.externalResolver?.(taskId);
  }

  getPersistenceId(task: ITask<any, Promise<any>, any, any, any, any>): string {
    return this.persistenceIdResolver?.(task) ?? task.id;
  }
}
