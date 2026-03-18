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
 * Coordinates task execution for the runtime.
 *
 * The task runner owns task admission checks, middleware composition,
 * execution-context tracking, abort-signal propagation, and health-policy
 * enforcement. It also adapts to the runtime lifecycle: before `store.lock()`,
 * tasks are recomposed on every call because resources may still register
 * interceptors during `init()`. After the store is locked, the interceptor
 * graph becomes stable, so composed runners are cached per task id for fast
 * repeated execution.
 */
export class TaskRunner {
  // Memoization store for composed middleware runners — only populated after
  // store.lock() when the middleware stack is frozen and composition is stable.
  protected readonly runnerStore = new Map<string | symbol, CachedTaskRunner>();

  /**
   * Creates a task runner bound to the shared runtime state.
   *
   * @param store The central runtime registry used to resolve tasks, resources,
   * and lifecycle state.
   * @param eventManager The event manager associated with the current runtime.
   * @param logger The runtime logger instance available to task execution.
   * @param executionContextStore The execution-context store used to propagate
   * nested task frames and abort signals.
   */
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

  /**
   * Executes a registered task through the runtime pipeline.
   *
   * This applies lifecycle admission checks, resolves the effective abort
   * signal, enforces task health policies, runs middleware, and records the
   * execution frame for nested task tracing.
   *
   * @param task The registered task definition to execute.
   * @param input The input payload passed to the task.
   * @param options Optional call metadata such as source and abort signal.
   * @returns The task result, or `undefined` if the task resolves without a
   * value.
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
   * Registers a global interceptor around task execution.
   *
   * Interceptors wrap the composed task middleware chain from the outside and
   * may optionally be limited to matching task definitions via `options.when`.
   * This must be called before `store.lock()`, while the runtime is still
   * building its middleware graph.
   *
   * @param interceptor The interceptor to apply around matching task runs.
   * @param options Optional filtering rules for when the interceptor should
   * execute.
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
   * Composes the executable middleware pipeline for a task definition.
   *
   * @param task The task whose middleware chain should be composed.
   * @returns The composed runner function for the task.
   */
  protected createRunnerWithMiddleware<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType,
  >(task: ITask<TInput, TOutput, TDeps>) {
    return this.middlewareManager.composeTaskRunner(task);
  }

  /**
   * Enforces the task-level fail-when-unhealthy policy once runtime execution
   * has started.
   *
   * @param task The task about to execute.
   * @returns A promise when an asynchronous health check is required.
   */
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

  /**
   * Ensures that all resources monitored by the task's health policy are both
   * reportable and currently healthy.
   *
   * @param task The task whose monitored resources are being validated.
   * @param monitoredResources The resources declared in the task's
   * `failWhenUnhealthy` tag.
   */
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

    const report = await this.store.getHealthReporter().getHealth(resourceIds, {
      isSleepingResource: (resourceId) =>
        this.store.resources.get(resourceId)!.isInitialized !== true,
    });
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
