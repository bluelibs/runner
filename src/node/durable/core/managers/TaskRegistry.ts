import type { DurableTask } from "../interfaces/service";

/**
 * In-memory durable task registry.
 *
 * Durable executions persist only a `taskId` in the store, so the runtime needs a way
 * to resolve `taskId -> DurableTask` when resuming. This registry holds tasks that
 * were registered on the current process and optionally delegates to an external
 * resolver for tasks defined elsewhere (useful for modular apps).
 */
export class TaskRegistry {
  private readonly tasks = new Map<string, DurableTask<any, any>>();

  constructor(
    private readonly externalResolver?: (
      taskId: string,
    ) => DurableTask<any, any> | undefined,
  ) {}

  register<TInput, TResult>(task: DurableTask<TInput, TResult>): void {
    this.tasks.set(task.id, task);
  }

  find(taskId: string): DurableTask<any, any> | undefined {
    return this.tasks.get(taskId) ?? this.externalResolver?.(taskId);
  }
}
