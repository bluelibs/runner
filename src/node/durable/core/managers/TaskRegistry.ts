import type { DurableTask } from "../interfaces/service";

/**
 * Simple task registry for durable workflows.
 * Stores registered tasks and supports external resolution.
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
