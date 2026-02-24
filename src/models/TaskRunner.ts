import { DependencyMapType, ITask } from "../defs";
import { EventManager } from "./EventManager";
import { Store } from "./Store";
import { Logger } from "./Logger";
import { MiddlewareManager } from "./MiddlewareManager";
import { shutdownLockdownError } from "../errors";
import { getPlatform } from "../platform";
import type { ExecutionJournal } from "../types/executionJournal";
import type {
  TaskRunnerInterceptOptions,
  TaskRunnerInterceptor,
} from "../types/taskRunner";
import type { TaskCallOptions } from "../types/utilities";
import { InFlightTracker } from "./utils/inFlightTracker";

type CachedTaskRunner = (
  input: unknown,
  journal?: ExecutionJournal,
) => Promise<unknown>;

export class TaskRunner {
  protected readonly runnerStore = new Map<string | symbol, CachedTaskRunner>();
  private readonly executionContext = getPlatform().hasAsyncLocalStorage()
    ? getPlatform().createAsyncLocalStorage<boolean>()
    : null;
  private readonly inFlightTracker = new InFlightTracker(() =>
    Boolean(this.executionContext?.getStore()),
  );

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
    if (this.store.isInShutdownLockdown()) {
      try {
        shutdownLockdownError.throw();
      } catch (error) {
        return Promise.reject(error);
      }
    }

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

    this.inFlightTracker.start();
    try {
      const executeTask = () => runner(input as TInput, options?.journal);
      // Pass journal if provided; composer will use it or create new
      return this.executionContext
        ? await this.executionContext.run(true, executeTask)
        : await executeTask();
    } finally {
      this.inFlightTracker.end();
    }
  }

  /**
   * Registers a global task execution interceptor.
   * Interceptors are evaluated outermost around task middleware.
   */
  public intercept(
    interceptor: TaskRunnerInterceptor,
    options?: TaskRunnerInterceptOptions,
  ): void {
    const conditionalInterceptor: TaskRunnerInterceptor = async (
      next,
      input,
    ) => {
      if (options?.when && !options.when(input.task.definition)) {
        return next(input);
      }

      return interceptor(next, input);
    };

    this.middlewareManager.intercept("task", conditionalInterceptor);
  }

  public waitForIdle(options?: {
    allowCurrentContext?: boolean;
  }): Promise<void> {
    return this.inFlightTracker.waitForIdle(options);
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
