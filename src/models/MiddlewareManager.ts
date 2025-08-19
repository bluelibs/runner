import { DependencyMapType, ITask, IResource } from "../defs";
import { EventManager } from "./EventManager";
import { Store } from "./Store";
import {
  TaskMiddlewareStoreElementType,
  ResourceMiddlewareStoreElementType,
} from "../types/storeTypes";
import { Logger } from "./Logger";
import { globalEvents } from "../globals/globalEvents";
import { ValidationError } from "../errors";

/**
 * Centralizes middleware composition and execution for both tasks and resources.
 * Keeps observability emissions and unhandled error routing consistent.
 */
export class MiddlewareManager {
  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger,
  ) {}

  /**
   * Compose a runner for a task with its local interceptors and applicable middlewares.
   * Returns a function that accepts the task input and resolves to the task output.
   */
  public composeTaskRunner<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType,
  >(task: ITask<TInput, TOutput, TDeps>) {
    const storeTask = this.store.tasks.get(task.id)!;

    // Base next executes the task with validation and unhandled error routing
    let next = async (input: any) => {
      if (task.inputSchema) {
        try {
          input = task.inputSchema.parse(input);
        } catch (error) {
          throw new ValidationError(
            "Task input",
            task.id,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }

      const deps = storeTask?.computedDependencies as any;
      try {
        const rawResult = await task.run.call(null, input, deps);
        if (task.resultSchema) {
          try {
            return task.resultSchema.parse(rawResult as any);
          } catch (error) {
            throw new ValidationError("Task result", task.id, error as any);
          }
        }
        return rawResult;
      } catch (error: unknown) {
        try {
          await this.store.onUnhandledError({
            error,
            kind: "task",
            source: task.id,
          });
        } catch (_) {}
        throw error;
      }
    };

    // Inject local per-task interceptors first (closest to the task)
    if (storeTask.interceptors && storeTask.interceptors.length > 0) {
      for (let i = storeTask.interceptors.length - 1; i >= 0; i--) {
        const interceptor = storeTask.interceptors[i];
        const nextFunction = next;
        next = async (input) => interceptor(nextFunction, input);
      }
    }

    const createdMiddlewares = this.getApplicableTaskMiddlewares(task);
    if (createdMiddlewares.length === 0) {
      return next;
    }

    // layer task middlewares (global first, then local), closest to the task runs last
    for (let i = createdMiddlewares.length - 1; i >= 0; i--) {
      const middleware = createdMiddlewares[i];
      const storeMiddleware = this.store.taskMiddlewares.get(middleware.id)!;

      const nextFunction = next;
      next = async (input) => {
        let result: any;
        try {
          await this.eventManager.emit(
            globalEvents.middlewareTriggered,
            {
              kind: "task",
              middleware: middleware as any,
              targetId: task.id as any,
            },
            middleware.id,
          );
          // Attention: we use the store middleware run, because it might have been overidden.
          // All middleware run() functions should be common accross all tasks.
          result = await storeMiddleware.middleware.run(
            {
              task: {
                definition: task,
                input,
              },
              next: nextFunction,
            },
            storeMiddleware?.computedDependencies as DependencyMapType,
            middleware.config,
          );
          await this.eventManager.emit(
            globalEvents.middlewareCompleted,
            {
              kind: "task",
              middleware: middleware,
              targetId: task.id,
            },
            middleware.id,
          );
          return result;
        } catch (error: unknown) {
          try {
            await this.store.onUnhandledError({
              error,
              kind: "middleware",
              source: middleware.id,
            });
          } catch (_) {}
          await this.eventManager.emit(
            globalEvents.middlewareCompleted,
            {
              kind: "task",
              middleware: middleware as any,
              targetId: task.id as any,
              error: error as any,
            },
            middleware.id,
          );
          throw error;
        }
      };
    }

    return next;
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
    dependencies: any,
    context: TContext,
  ): Promise<V | undefined> {
    let next = async (cfg: C): Promise<V | undefined> => {
      if (!resource.init) return undefined as unknown as V;
      const rawValue = await resource.init.call(
        null,
        cfg,
        dependencies,
        context,
      );
      if (resource.resultSchema) {
        try {
          return resource.resultSchema.parse(rawValue);
        } catch (error) {
          throw new ValidationError(
            "Resource result",
            resource.id,
            error as any,
          );
        }
      }
      return rawValue as any;
    };

    const createdMiddlewares = this.getApplicableResourceMiddlewares(resource);
    for (let i = createdMiddlewares.length - 1; i >= 0; i--) {
      const middleware = createdMiddlewares[i];
      const storeMiddleware = this.store.resourceMiddlewares.get(
        middleware.id,
      )!;

      const nextFunction = next;
      next = async (cfg: C) => {
        await this.eventManager.emit(
          globalEvents.middlewareTriggered,
          {
            kind: "resource",
            middleware: middleware as any,
            targetId: resource.id as any,
          },
          middleware.id as any,
        );
        try {
          const result = await storeMiddleware.middleware.run(
            {
              resource: {
                definition: resource,
                config: cfg,
              },
              next: nextFunction,
            },
            storeMiddleware.computedDependencies,
            middleware.config,
          );
          await this.eventManager.emit(
            globalEvents.middlewareCompleted,
            {
              kind: "resource",
              middleware: middleware as any,
              targetId: resource.id as any,
            },
            middleware.id as any,
          );
          return result as any;
        } catch (error: unknown) {
          try {
            await this.store.onUnhandledError({
              error,
              kind: "resourceInit",
              source: resource.id,
            });
          } catch (_) {}
          await this.eventManager.emit(
            globalEvents.middlewareCompleted,
            {
              kind: "resource",
              middleware: middleware as any,
              targetId: resource.id as any,
              error: error as any,
            },
            middleware.id as any,
          );
          throw error;
        }
      };
    }

    return next(config);
  }

  private getApplicableTaskMiddlewares<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType,
  >(task: ITask<TInput, TOutput, TDeps>) {
    const existingMiddlewares = task.middleware;
    const existingMiddlewareIds = existingMiddlewares.map((x) => x.id);
    const globalMiddlewares = this.store
      .getEverywhereMiddlewareForTasks(task)
      .filter((x) => !existingMiddlewareIds.includes(x.id));
    return [...globalMiddlewares, ...existingMiddlewares];
  }

  private getApplicableResourceMiddlewares<
    C,
    V extends Promise<any>,
    D extends DependencyMapType,
    TContext,
  >(resource: IResource<C, V, D, TContext>) {
    const existingMiddlewares = resource.middleware;
    const existingMiddlewareIds = existingMiddlewares.map((x) => x.id);
    const globalMiddlewares = this.store
      .getEverywhereMiddlewareForResources(resource)
      .filter((x) => !existingMiddlewareIds.includes(x.id));
    return [...globalMiddlewares, ...existingMiddlewares];
  }
}
