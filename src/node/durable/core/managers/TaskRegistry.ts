import type { ITask } from "../../../../types/task";
import { check, Match } from "../../../../tools/check";
import { durableExecutionInvariantError } from "../../../../errors";
import { durableWorkflowTag } from "../../tags/durableWorkflow.tag";

/**
 * In-memory durable task registry.
 *
 * Durable executions persist only a `workflowKey` in the store, so the runtime needs a way
 * to resolve `workflowKey -> ITask` when resuming. This registry holds tasks that
 * were registered on the current process and optionally delegates to an external
 * resolver for tasks defined elsewhere (useful for modular apps).
 */
export class TaskRegistry {
  private readonly versions = new Map<
    string,
    ITask<any, Promise<any>, any, any, any, any>
  >();
  private readonly tasks = new Map<
    string,
    ITask<any, Promise<any>, any, any, any, any>
  >();

  constructor(
    private readonly externalResolver?: (
      workflowKey: string,
      version?: number,
    ) => ITask<any, Promise<any>, any, any, any, any> | undefined,
    private readonly workflowKeyResolver?: (
      task: ITask<any, Promise<any>, any, any, any, any>,
    ) => string | undefined,
    private readonly taskKeyResolver?: (
      task: ITask<any, Promise<any>, any, any, any, any>,
    ) => string,
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
    const version = durableWorkflowTag.extract(task)?.version;
    const versionKey = JSON.stringify([workflowKey, version]);
    const sameVersion = this.versions.get(versionKey);
    const conflict =
      sameVersion ?? (version === undefined ? existing : undefined);
    if (conflict && this.getTaskKey(conflict) !== this.getTaskKey(task)) {
      durableExecutionInvariantError.throw({
        message: `Durable workflow key '${workflowKey}' is already registered for task '${this.getTaskKey(conflict)}' and cannot be reused by '${this.getTaskKey(task)}'.`,
      });
    }

    const existingTaskId = this.tasks.get(task.id);
    if (existingTaskId && existingTaskId.id !== task.id) {
      durableExecutionInvariantError.throw({
        message: `Durable task id '${task.id}' collides with an existing workflow alias for task '${existingTaskId.id}'.`,
      });
    }

    this.tasks.set(task.id, task);
    this.versions.set(versionKey, task);
    if (workflowKey !== task.id && version === undefined) {
      this.tasks.set(workflowKey, task);
    }
  }

  find(
    workflowKey: string,
    version?: number,
  ): ITask<any, Promise<any>, any, any, any, any> | undefined {
    const task =
      this.versions.get(JSON.stringify([workflowKey, version])) ??
      this.tasks.get(workflowKey) ??
      this.externalResolver?.(workflowKey, version);
    return task && durableWorkflowTag.extract(task)?.version === version
      ? task
      : undefined;
  }

  /** Canonical task addressing is separate from an optional workflow storage key. */
  getTaskKey(task: ITask<any, Promise<any>, any, any, any, any>): string {
    return this.taskKeyResolver?.(task) ?? task.id;
  }

  /** Resolves an explicit task reference for a new start; existing executions use find(). */
  resolve(reference: string) {
    return this.tasks.get(reference) ?? this.find(reference);
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
    return (
      this.workflowKeyResolver?.(task) ??
      (durableWorkflowTag.extract(task)?.version !== undefined
        ? durableWorkflowTag.extract(task)?.key
        : undefined) ??
      task.id
    );
  }
}
