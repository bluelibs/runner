import { DependencyMapType, ITask } from "../defs";
import { EventManager } from "./EventManager";
import { Store } from "./Store";
import { Logger } from "./Logger";
import { MiddlewareManager } from "./MiddlewareManager";
import {
  interceptAfterLockError,
  runtimeAdmissionsPausedError,
  shutdownLockdownError,
} from "../errors";
import {
  taskBlockedByResourceHealthError,
  taskHealthResourceNotReportableError,
} from "../errors";
import type {
  TaskRunnerInterceptOptions,
  TaskRunnerInterceptor,
} from "../types/taskRunner";
import type { TaskCallOptions } from "../types/utilities";
import type { IResource } from "../defs";
import {
  RuntimeCallSource,
  RuntimeCallSourceKind,
  runtimeSource,
} from "../types/runtimeSource";
import type { LifecycleAdmissionController } from "./runtime/LifecycleAdmissionController";
import { RuntimeLifecyclePhase } from "./runtime/LifecycleAdmissionController";
import { ExecutionContextStore } from "./ExecutionContextStore";
import type { ExecutionFrame } from "../types/executionContext";
import { globalTags } from "../globals/globalTags";
import { HealthReporter } from "./HealthReporter";
import { raceWithAbortSignal } from "../tools/abortSignals";

type CachedTaskRunner = (
  input: unknown,
  options?: TaskCallOptions,
) => Promise<unknown>;

const defaultTaskSource: RuntimeCallSource = {
  kind: RuntimeCallSourceKind.Runtime,
  id: "runtime-internal-taskRunner",
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
    private readonly executionContextStore: ExecutionContextStore = new ExecutionContextStore(
      null,
    ),
  ) {
    // Use the same MiddlewareManager instance from the Store so that
    // any interceptors registered via resources (like debug) affect task runs.
    this.middlewareManager = this.store.getMiddlewareManager();
    this.lifecycleAdmissionController =
      this.store.getLifecycleAdmissionController();
  }

  private readonly middlewareManager: MiddlewareManager;
  private readonly lifecycleAdmissionController: LifecycleAdmissionController;
  private readonly healthReporter = new HealthReporter(this.store, {
    ensureAvailable: () => undefined,
    isSleepingResource: (resourceId) =>
      this.store.resources.get(resourceId)!.isInitialized !== true,
  });

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
    const taskId = this.store.findIdByDefinition(task);
    const source = options?.source ?? defaultTaskSource;
    const signal = this.executionContextStore.resolveSignal(options?.signal);
    if (!this.store.canAdmitTaskCall(source)) {
      if (
        this.lifecycleAdmissionController.getPhase() ===
        RuntimeLifecyclePhase.Paused
      ) {
        runtimeAdmissionsPausedError.throw();
      }
      shutdownLockdownError.throw();
    }

    // Middleware chain caching is lock-gated: during init(), resources may still
    // call taskRunner.intercept() — so the middleware stack is mutable and caching
    // a composed runner would silently freeze a partial chain. After store.lock(),
    // no new interceptors can be added, making the composition stable and safe to
    // memoize. This is lazy — we only compose on first post-lock call per task.
    const canCacheRunner = this.store.isLocked;
    let runner = canCacheRunner
      ? (this.runnerStore.get(taskId) as
          | ((input: TInput, options?: TaskCallOptions) => Promise<TOutput>)
          | undefined)
      : undefined;
    if (!runner) {
      runner = this.createRunnerWithMiddleware<TInput, TOutput, TDeps>(task);
      if (canCacheRunner) {
        this.runnerStore.set(taskId, runner as CachedTaskRunner);
      }
    }

    const executeTask = async () => {
      const healthPolicyCheck = this.assertTaskHealthPolicy(task);
      if (healthPolicyCheck) {
        await healthPolicyCheck;
      }
      return raceWithAbortSignal(
        runner(input as TInput, {
          ...(options ?? {}),
          signal,
          source,
        }),
        signal,
      );
    };
    const executionSource = runtimeSource.task(taskId);

    const traceFrame: ExecutionFrame = {
      kind: "task",
      id: taskId as string,
      source: executionSource,
      timestamp: Date.now(),
    };

    return this.lifecycleAdmissionController.trackTaskExecution(
      executionSource,
      () =>
        this.executionContextStore.runWithFrame(traceFrame, executeTask, {
          signal,
        }),
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
      if (options?.when) {
        const taskDefinition = input.task.definition;
        const canonicalTaskDefinition =
          this.store.resolveRegisteredDefinition(taskDefinition);
        if (!options.when(canonicalTaskDefinition as typeof taskDefinition)) {
          return next(input);
        }
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

  private assertTaskHealthPolicy(
    task: ITask<any, any, any>,
  ): Promise<void> | void {
    if (!this.store.isLocked) {
      return;
    }

    const monitoredResources = globalTags.failWhenUnhealthy.extract(task);
    if (!monitoredResources || monitoredResources.length === 0) {
      return;
    }

    return this.assertMonitoredResourcesHealthy(task, monitoredResources);
  }

  private async assertMonitoredResourcesHealthy(
    task: ITask<any, any, any>,
    monitoredResources: ReadonlyArray<
      string | IResource<any, any, any, any, any>
    >,
  ): Promise<void> {
    const resourceIds = monitoredResources.map((resource) =>
      this.store.findIdByDefinition(resource),
    );
    const nonReportableResourceIds = resourceIds.filter((resourceId) => {
      const resourceEntry = this.store.resources.get(resourceId);
      return !resourceEntry?.resource.health;
    });

    if (nonReportableResourceIds.length > 0) {
      taskHealthResourceNotReportableError.throw({
        taskId: this.store.findIdByDefinition(task),
        resourceIds: nonReportableResourceIds,
      });
    }

    const report = await this.healthReporter.getHealth(resourceIds);
    const unhealthyResourceIds = report.report
      .filter((entry) => entry.status === "unhealthy")
      .map((entry) => entry.id);

    if (unhealthyResourceIds.length > 0) {
      taskBlockedByResourceHealthError.throw({
        taskId: this.store.findIdByDefinition(task),
        resourceIds: unhealthyResourceIds,
      });
    }
  }
}
