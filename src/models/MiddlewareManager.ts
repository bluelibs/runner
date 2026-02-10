import {
  DependencyMapType,
  ITask,
  IResource,
  ResourceDependencyValuesType,
} from "../defs";
import { Store } from "./Store";
import { ITaskMiddleware, IResourceMiddleware } from "../defs";
import { isResourceMiddleware, isTaskMiddleware } from "../define";
import { InterceptorRegistry } from "./middleware/InterceptorRegistry";
import { MiddlewareResolver } from "./middleware/MiddlewareResolver";
import { TaskMiddlewareComposer } from "./middleware/TaskMiddlewareComposer";
import { ResourceMiddlewareComposer } from "./middleware/ResourceMiddlewareComposer";
import {
  TaskMiddlewareInterceptor,
  ResourceMiddlewareInterceptor,
} from "./middleware/types";

// Re-export types for backwards compatibility
export type { TaskMiddlewareInterceptor, ResourceMiddlewareInterceptor };

/**
 * Centralizes middleware composition and execution for both tasks and resources.
 * Keeps observability emissions and unhandled error routing consistent.
 *
 * This is a facade that delegates to specialized composer classes for maintainability.
 */
export class MiddlewareManager {
  private readonly interceptorRegistry: InterceptorRegistry;
  private readonly middlewareResolver: MiddlewareResolver;
  private readonly taskComposer: TaskMiddlewareComposer;
  private readonly resourceComposer: ResourceMiddlewareComposer;

  constructor(
    protected readonly store: Store,
    _eventManager: unknown,
    _logger: unknown,
  ) {
    this.interceptorRegistry = new InterceptorRegistry();
    this.middlewareResolver = new MiddlewareResolver(store);
    this.taskComposer = new TaskMiddlewareComposer(
      store,
      this.interceptorRegistry,
      this.middlewareResolver,
    );
    this.resourceComposer = new ResourceMiddlewareComposer(
      store,
      this.interceptorRegistry,
      this.middlewareResolver,
    );
  }

  /**
   * @internal
   */
  public get taskMiddlewareInterceptors() {
    return this.interceptorRegistry.getGlobalTaskInterceptors();
  }

  /**
   * @internal
   */
  public get resourceMiddlewareInterceptors() {
    return this.interceptorRegistry.getGlobalResourceInterceptors();
  }

  /**
   * Gets the current lock status of the MiddlewareManager
   */
  get isLocked(): boolean {
    return this.interceptorRegistry.isLocked;
  }

  /**
   * Locks the MiddlewareManager, preventing any further modifications to interceptors
   */
  lock(): void {
    this.interceptorRegistry.lock();
  }

  /**
   * Adds an interceptor for task or resource middleware execution
   * Interceptors are executed in the order they are added, with the ability to
   * modify, log, or prevent middleware execution
   *
   * @param kind - The type of middleware to intercept ("task" or "resource")
   * @param interceptor - The interceptor function to add
   */
  intercept(kind: "task", interceptor: TaskMiddlewareInterceptor): void;
  intercept(kind: "resource", interceptor: ResourceMiddlewareInterceptor): void;
  intercept(
    kind: "task" | "resource",
    interceptor: TaskMiddlewareInterceptor | ResourceMiddlewareInterceptor,
  ): void {
    if (kind === "task") {
      this.interceptorRegistry.addGlobalTaskInterceptor(
        interceptor as TaskMiddlewareInterceptor,
      );
    } else {
      this.interceptorRegistry.addGlobalResourceInterceptor(
        interceptor as ResourceMiddlewareInterceptor,
      );
    }
  }

  /**
   * Adds an interceptor for a specific middleware instance with better type safety
   * This method automatically determines the type and provides type-safe access
   *
   * @param middleware - The middleware instance to intercept
   * @param interceptor - The interceptor function with proper typing
   */
  interceptMiddleware(
    middleware: ITaskMiddleware<any, any, any, any>,
    interceptor: TaskMiddlewareInterceptor,
  ): void;
  interceptMiddleware(
    middleware: IResourceMiddleware<any, any, any, any>,
    interceptor: ResourceMiddlewareInterceptor,
  ): void;
  interceptMiddleware(
    middleware:
      | ITaskMiddleware<any, any, any, any>
      | IResourceMiddleware<any, any, any, any>,
    interceptor: TaskMiddlewareInterceptor | ResourceMiddlewareInterceptor,
  ): void {
    if (isTaskMiddleware(middleware)) {
      this.interceptorRegistry.addTaskMiddlewareInterceptor(
        middleware.id,
        interceptor as TaskMiddlewareInterceptor,
      );
    } else if (isResourceMiddleware(middleware)) {
      this.interceptorRegistry.addResourceMiddlewareInterceptor(
        middleware.id,
        interceptor as ResourceMiddlewareInterceptor,
      );
    } else {
      throw new Error("Unknown middleware type");
    }
  }

  /**
   * Compose a runner for a task with its local interceptors and applicable middlewares.
   * Returns a function that accepts the task input and resolves to the task output.
   */
  public composeTaskRunner<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType,
  >(task: ITask<TInput, TOutput, TDeps>) {
    return this.taskComposer.compose(task);
  }

  /**
   * Run a resource init wrapped with its applicable middlewares.
   */
  public async runResourceInit<
    C,
    V extends Promise<any>,
    D extends DependencyMapType,
    TContext,
  >(
    resource: IResource<C, V, D, TContext>,
    config: C,
    dependencies: ResourceDependencyValuesType<D>,
    context: TContext,
  ): Promise<V | undefined> {
    return this.resourceComposer.runInit(
      resource,
      config,
      dependencies,
      context,
    );
  }

  /**
   * Gets all "everywhere" middlewares that apply to the given task
   * @deprecated Internal method exposed for testing - may be removed in future versions
   */
  getEverywhereMiddlewareForTasks(
    task: ITask<any, any, any>,
  ): ITaskMiddleware[] {
    return this.middlewareResolver.getEverywhereTaskMiddlewares(task);
  }

  /**
   * Gets all "everywhere" middlewares that apply to the given resource
   * @deprecated Internal method exposed for testing - may be removed in future versions
   */
  getEverywhereMiddlewareForResources(
    resource: IResource<any, any, any, any>,
  ): IResourceMiddleware[] {
    return this.middlewareResolver.getEverywhereResourceMiddlewares(resource);
  }
}
