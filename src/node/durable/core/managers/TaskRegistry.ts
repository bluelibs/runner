import type { ITask } from "../../../../types/task";

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
    this.tasks.set(task.id, task);
    const persistenceId = this.getPersistenceId(task);
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
