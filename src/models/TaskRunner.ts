import { DependencyMapType, ITask } from "../defs";
import { EventManager } from "./EventManager";
import { Store } from "./Store";
import { Logger } from "./Logger";
import { MiddlewareManager } from "./MiddlewareManager";
import { interceptAfterLockError, shutdownLockdownError } from "../errors";
import type { ExecutionJournal } from "../types/executionJournal";
import type {
  TaskRunnerInterceptOptions,
  TaskRunnerInterceptor,
} from "../types/taskRunner";
import type { TaskCallOptions } from "../types/utilities";
import {
  RuntimeCallSource,
  RuntimeCallSourceKind,
  runtimeSource,
} from "../types/runtimeSource";
import type { LifecycleAdmissionController } from "./runtime/LifecycleAdmissionController";

type CachedTaskRunner = (
  input: unknown,
  journal?: ExecutionJournal,
  source?: RuntimeCallSource,
) => Promise<unknown>;

const defaultTaskSource: RuntimeCallSource = {
  kind: RuntimeCallSourceKind.Runtime,
  id: "runtime.internal.taskRunner",
};

/**
 * Executes tasks through the middleware pipeline with lifecycle-aware caching.
 *
 * Tasks are callable during both init() (pre-lock) and runtime (post-lock).
 * During init(), resources legitimately call tasks — seeding data, validating
 * state, running migrations, etc. However, other resources may still register
 * interceptors via taskRunner.intercept() during their own init() phase,
 * meaning the middleware stack is mutable. Caching a composed runner at this
 * point would silently freeze a partial chain — a task called before and after
 * an interceptor registration would behave differently, which is a correctness
 * bug. So pre-lock calls always recompose from scratch to pick up the latest
 * interceptors.
 *
 * After store.lock(), no new interceptors can be added (checkLock() throws),
 * making the composition stable. At that point we lazily cache the composed
 * runner per task id — one Map lookup per subsequent call. Pre-computing all
 * runners eagerly at lock-time would be wasteful: not all tasks are called, and
 * lazy resources may never materialize. The first post-lock call per task pays
 * a microsecond-level composition cost; every call after that is a Map.get().
 */
export class TaskRunner {
  // Memoization store for composed middleware runners — only populated after
  // store.lock() when the middleware stack is frozen and composition is stable.
  protected readonly runnerStore = new Map<string | symbol, CachedTaskRunner>();

  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger,
  ) {
    // Use the same MiddlewareManager instance from the Store so that
    // any interceptors registered via resources (like debug) affect task runs.
    this.middlewareManager = this.store.getMiddlewareManager();
    this.lifecycleAdmissionController =
      this.store.getLifecycleAdmissionController();
  }

  private readonly middlewareManager: MiddlewareManager;
  private readonly lifecycleAdmissionController: LifecycleAdmissionController;

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
    const source = options?.source ?? defaultTaskSource;
    if (!this.store.canAdmitTaskCall(source)) {
      shutdownLockdownError.throw();
    }

    // Middleware chain caching is lock-gated: during init(), resources may still
    // call taskRunner.intercept() — so the middleware stack is mutable and caching
    // a composed runner would silently freeze a partial chain. After store.lock(),
    // no new interceptors can be added, making the composition stable and safe to
    // memoize. This is lazy — we only compose on first post-lock call per task.
    const canCacheRunner = this.store.isLocked;
    let runner = canCacheRunner
      ? (this.runnerStore.get(task.id) as
          | ((
              input: TInput,
              journal?: ExecutionJournal,
              source?: RuntimeCallSource,
            ) => Promise<TOutput>)
          | undefined)
      : undefined;
    if (!runner) {
      runner = this.createRunnerWithMiddleware<TInput, TOutput, TDeps>(task);
      if (canCacheRunner) {
        this.runnerStore.set(task.id, runner as CachedTaskRunner);
      }
    }

    const executeTask = () => runner(input as TInput, options?.journal, source);
    const executionSource = runtimeSource.task(task.id);
    // Pass journal if provided; composer will use it or create new
    return this.lifecycleAdmissionController.trackTaskExecution(
      executionSource,
      executeTask,
    );
  }

  /**
   * Registers a global task execution interceptor.
   * Interceptors are evaluated outermost around task middleware.
   *
   * Must be called during init() (pre-lock). After store.lock(), the middleware
   * stack is frozen and calling intercept() would create inconsistency between
   * already-cached runners and newly-composed ones.
   */
  public intercept(
    interceptor: TaskRunnerInterceptor,
    options?: TaskRunnerInterceptOptions,
  ): void {
    if (this.store.isLocked) {
      interceptAfterLockError.throw({});
    }

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
