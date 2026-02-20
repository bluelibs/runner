import { DependencyMapType, ITask } from "../defs";
import { EventManager } from "./EventManager";
import { Store } from "./Store";
import { Logger } from "./Logger";
import { MiddlewareManager } from "./MiddlewareManager";
import type { ExecutionJournal } from "../types/executionJournal";
import type { TaskCallOptions } from "../types/utilities";

type CachedTaskRunner = (
  input: unknown,
  journal?: ExecutionJournal,
) => Promise<unknown>;

export class TaskRunner {
  protected readonly runnerStore = new Map<string | symbol, CachedTaskRunner>();

  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger,
  ) {
    // Use the same MiddlewareManager instance from the Store so that
    // any interceptors registered via resources (like debug) affect task runs.
    this.middlewareManager = this.store.getMiddlewareManager();
  }

  private readonly middlewareManager: MiddlewareManager;

  /**
   * Begins the execution of a task. These are registered tasks and all sanity checks have been performed at this stage to ensure consistency of the object.
   * This function can throw only if any of the event listeners or run function throws
   * @param task the task to be run
   * @param input the input to be passed to the task
   * @param options optional call options including journal for forwarding
   */
  public async run<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType,
  >(
    task: ITask<TInput, TOutput, TDeps>,
    input?: TInput,
    options?: TaskCallOptions,
  ): Promise<TOutput | undefined> {
    const canUseCachedRunner = this.store.isLocked;
    let runner = canUseCachedRunner
      ? (this.runnerStore.get(task.id) as
          | ((input: TInput, journal?: ExecutionJournal) => Promise<TOutput>)
          | undefined)
      : undefined;
    if (!runner) {
      runner = this.createRunnerWithMiddleware<TInput, TOutput, TDeps>(task);
      if (canUseCachedRunner) {
        this.runnerStore.set(task.id, runner as CachedTaskRunner);
      }
    }

    // Pass journal if provided; composer will use it or create new
    return await runner(input as TInput, options?.journal);
  }

  /**
   * Creates the function with the chain of middleware.
   * @param task
   * @returns
   */
  protected createRunnerWithMiddleware<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType,
  >(task: ITask<TInput, TOutput, TDeps>) {
    return this.middlewareManager.composeTaskRunner(task);
  }
}
