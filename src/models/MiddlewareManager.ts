import {
  DependencyMapType,
  ITask,
  IResource,
  ITaskMiddleware,
  ResourceMiddlewareAttachmentType,
  TagType,
} from "../defs";
import { EventManager } from "./EventManager";
import { Store } from "./Store";
import {
  TaskMiddlewareStoreElementType,
  ResourceMiddlewareStoreElementType,
} from "../types/storeTypes";
import { Logger } from "./Logger";
import { globalEvents } from "../globals/globalEvents";
import { ValidationError, LockedError } from "../errors";
import * as utils from "../define";
import { symbol } from "zod";
import { ITaskMiddlewareExecutionInput } from "../types/taskMiddleware";
import {
  IResourceMiddlewareExecutionInput,
  IResourceMiddleware,
} from "../types/resourceMiddleware";
import {
  symbolTaskMiddleware,
  symbolResourceMiddleware,
} from "../types/symbols";
import { isResourceMiddleware, isTaskMiddleware } from "../define";

/**
 * Interceptor for task middleware execution
 */
export type TaskMiddlewareInterceptor = (
  next: (input: ITaskMiddlewareExecutionInput<any>) => Promise<any>,
  input: ITaskMiddlewareExecutionInput<any>,
) => Promise<any>;

/**
 * Interceptor for resource middleware execution
 */
export type ResourceMiddlewareInterceptor = (
  next: (input: IResourceMiddlewareExecutionInput<any>) => Promise<any>,
  input: IResourceMiddlewareExecutionInput<any>,
) => Promise<any>;

/**
 * Centralizes middleware composition and execution for both tasks and resources.
 * Keeps observability emissions and unhandled error routing consistent.
 */
export class MiddlewareManager {
  // Interceptor storage
  private taskMiddlewareInterceptors: TaskMiddlewareInterceptor[] = [];
  private resourceMiddlewareInterceptors: ResourceMiddlewareInterceptor[] = [];

  // Per-middleware interceptor storage
  private perMiddlewareInterceptors: Map<string, TaskMiddlewareInterceptor[]> =
    new Map();
  private perResourceMiddlewareInterceptors: Map<
    string,
    ResourceMiddlewareInterceptor[]
  > = new Map();

  // Locking mechanism to prevent modifications after initialization
  #isLocked = false;

  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger,
  ) {}

  /**
   * Gets the current lock status of the MiddlewareManager
   */
  get isLocked() {
    return this.#isLocked;
  }

  /**
   * Locks the MiddlewareManager, preventing any further modifications to interceptors
   */
  lock() {
    this.#isLocked = true;
  }

  /**
   * Throws an error if the MiddlewareManager is locked
   */
  private checkLock() {
    if (this.#isLocked) {
      throw new LockedError("MiddlewareManager");
    }
  }

  /**
   * Adds an interceptor for task or resource middleware execution
   * Interceptors are executed in the order they are added, with the ability to
   * modify, log, or prevent middleware execution
   *
   * @param kind - The type of middleware to intercept ("task" or "resource")
   * @param interceptor - The interceptor function to add
   */
  intercept(
    kind: "task" | "resource",
    interceptor: TaskMiddlewareInterceptor | ResourceMiddlewareInterceptor,
  ): void {
    this.checkLock();

    if (kind === "task") {
      this.taskMiddlewareInterceptors.push(
        interceptor as TaskMiddlewareInterceptor,
      );
    } else {
      this.resourceMiddlewareInterceptors.push(
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
    middleware:
      | ITaskMiddleware<any, any, any, any>
      | IResourceMiddleware<any, any, any, any>,
    interceptor: TaskMiddlewareInterceptor | ResourceMiddlewareInterceptor,
  ): void {
    this.checkLock();

    // Determine the type based on the middleware's symbol
    if (isTaskMiddleware(middleware)) {
      // Store per-middleware interceptor instead of adding to global pool
      if (!this.perMiddlewareInterceptors.has(middleware.id)) {
        this.perMiddlewareInterceptors.set(middleware.id, []);
      }
      this.perMiddlewareInterceptors
        .get(middleware.id)!
        .push(interceptor as TaskMiddlewareInterceptor);
    } else if (isResourceMiddleware(middleware)) {
      // Store per-middleware interceptor instead of adding to global pool
      if (!this.perResourceMiddlewareInterceptors.has(middleware.id)) {
        this.perResourceMiddlewareInterceptors.set(middleware.id, []);
      }
      this.perResourceMiddlewareInterceptors
        .get(middleware.id)!
        .push(interceptor as ResourceMiddlewareInterceptor);
    } else {
      throw new Error("Unknown middleware type");
    }
  }

  /**
   * Wrap a middleware with its specific interceptors in onion style
   */
  private wrapMiddlewareWithInterceptors<TInput, TOutput extends Promise<any>>(
    middleware: ITaskMiddleware<any, any, any, any>,
    middlewareRunner: (input: TInput) => Promise<TOutput>,
    interceptors: TaskMiddlewareInterceptor[],
  ): (input: TInput) => Promise<TOutput> {
    if (!interceptors.length) {
      return middlewareRunner;
    }

    // Apply interceptors in reverse order (last added runs first)
    const reversedInterceptors = [...interceptors].reverse();

    let wrapped = middlewareRunner;
    for (let i = reversedInterceptors.length - 1; i >= 0; i--) {
      const interceptor = reversedInterceptors[i];
      const nextFunction = wrapped;

      wrapped = async (input: TInput) => {
        // Create execution input for the interceptor
        const executionInput: ITaskMiddlewareExecutionInput<any> = {
          task: {
            definition: null as any, // Will be filled by middleware.run
            input: input,
          },
          next: nextFunction as any,
        };

        // Provide a next function that accepts an execution input and forwards the raw input
        const wrappedNext = (
          i: ITaskMiddlewareExecutionInput<any>,
        ): Promise<any> => {
          return nextFunction(i.task.input);
        };

        return interceptor(wrappedNext as any, executionInput);
      };
    }

    return wrapped;
  }

  /**
   * Wrap a resource middleware with its specific interceptors in onion style
   */
  private wrapResourceMiddlewareWithInterceptors<C, V extends Promise<any>>(
    middleware: IResourceMiddleware<any, any, any, any>,
    middlewareRunner: (config: C) => Promise<V>,
    interceptors: ResourceMiddlewareInterceptor[],
  ): (config: C) => Promise<V> {
    if (!interceptors.length) {
      return middlewareRunner;
    }

    // Apply interceptors in reverse order (last added runs first)
    const reversedInterceptors = [...interceptors].reverse();

    let wrapped = middlewareRunner;
    for (let i = reversedInterceptors.length - 1; i >= 0; i--) {
      const interceptor = reversedInterceptors[i];
      const nextFunction = wrapped;

      wrapped = async (config: C) => {
        // Create execution input for the interceptor
        const executionInput: IResourceMiddlewareExecutionInput<any> = {
          resource: {
            definition: null as any, // Will be filled by middleware.run
            config: config,
          },
          next: nextFunction as any,
        };

        // Provide a next function that accepts an execution input and forwards the raw config
        const wrappedNext = (input: IResourceMiddlewareExecutionInput<any>) => {
          return nextFunction(input.resource.config);
        };

        return interceptor(wrappedNext as any, executionInput);
      };
    }

    return wrapped;
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
    const storeTask = this.store.tasks.get(task.id)!;

    // Base next executes the task with validation and unhandled error routing
    let next = async (input: any) => {
      // Extract raw input from execution input if needed
      let rawInput = input;

      if (task.inputSchema) {
        try {
          rawInput = task.inputSchema.parse(rawInput);
        } catch (error) {
          throw new ValidationError(
            "Task input",
            task.id,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }

      const deps = storeTask.computedDependencies;
      try {
        const rawResult = await task.run.call(null, rawInput, deps);
        if (task.resultSchema) {
          try {
            return task.resultSchema.parse(rawResult);
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

    // Apply task middleware interceptors (last added runs first)
    if (this.taskMiddlewareInterceptors.length > 0) {
      const reversedInterceptors = [
        ...this.taskMiddlewareInterceptors,
      ].reverse();

      // Create the final execution input for the chain
      const createExecutionInput = (
        input: any,
        nextFunc: any,
      ): ITaskMiddlewareExecutionInput<any> => ({
        task: {
          definition: task,
          input: input,
        },
        next: nextFunc,
      });

      // Build the interceptor chain
      let currentNext = next;

      for (let i = reversedInterceptors.length - 1; i >= 0; i--) {
        const interceptor = reversedInterceptors[i];
        const nextFunction = currentNext;

        currentNext = async (input) => {
          const executionInput = createExecutionInput(input, nextFunction);
          // Create a wrapper function that matches the expected signature
          const wrappedNext = (
            i: ITaskMiddlewareExecutionInput<any>,
          ): Promise<any> => {
            return nextFunction(i.task.input);
          };
          return interceptor(wrappedNext, executionInput);
        };
      }

      next = currentNext;
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

      // Create the base middleware runner with events
      const baseMiddlewareRunner = async (input: any) => {
        let result: any;
        try {
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
            storeMiddleware.computedDependencies,
            middleware.config,
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

          throw error;
        }
      };

      // Get interceptors for this specific middleware
      const middlewareInterceptors =
        this.perMiddlewareInterceptors.get(middleware.id) || [];

      // Wrap the middleware with its interceptors (onion style)
      const wrappedMiddleware = this.wrapMiddlewareWithInterceptors(
        middleware,
        baseMiddlewareRunner,
        middlewareInterceptors,
      );

      next = wrappedMiddleware;
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

      // Create the base resource middleware runner with events
      const baseMiddlewareRunner = async (cfg: C) => {
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

          return result as any;
        } catch (error: unknown) {
          try {
            await this.store.onUnhandledError({
              error,
              kind: "resourceInit",
              source: resource.id,
            });
          } catch (_) {}

          throw error;
        }
      };

      // Get interceptors for this specific middleware
      const middlewareInterceptors =
        this.perResourceMiddlewareInterceptors.get(middleware.id) || [];

      // Wrap the middleware with its interceptors (onion style)
      const wrappedMiddleware = this.wrapResourceMiddlewareWithInterceptors(
        middleware,
        baseMiddlewareRunner,
        middlewareInterceptors,
      );

      next = wrappedMiddleware;
    }

    // Apply resource middleware interceptors (last added runs first)
    if (this.resourceMiddlewareInterceptors.length > 0) {
      const reversedInterceptors = [
        ...this.resourceMiddlewareInterceptors,
      ].reverse();

      // Create the final execution input for the chain
      const createExecutionInput = (
        config: C,
        nextFunc: any,
      ): IResourceMiddlewareExecutionInput<C> => ({
        resource: {
          definition: resource,
          config: config,
        },
        next: nextFunc,
      });

      // Build the interceptor chain
      let currentNext = next;

      for (let i = reversedInterceptors.length - 1; i >= 0; i--) {
        const interceptor = reversedInterceptors[i];
        const nextFunction = currentNext;

        currentNext = async (cfg: C) => {
          const executionInput = createExecutionInput(cfg, nextFunction);
          // Create a wrapper function that matches the expected signature
          const wrappedNext = (
            input: IResourceMiddlewareExecutionInput<any>,
          ) => {
            return nextFunction(input.resource.config);
          };
          return interceptor(wrappedNext, executionInput);
        };
      }

      next = currentNext;
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
    const globalMiddlewares = this.getEverywhereMiddlewareForTasks(task).filter(
      (x) => !existingMiddlewareIds.includes(x.id),
    );
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
    const globalMiddlewares = this.getEverywhereMiddlewareForResources(
      resource,
    ).filter((x) => !existingMiddlewareIds.includes(x.id));
    return [...globalMiddlewares, ...existingMiddlewares];
  }

  /**
   * @param task
   * @returns
   */
  getEverywhereMiddlewareForTasks(
    task: ITask<any, any, any, any>,
  ): ITaskMiddleware[] {
    return Array.from(this.store.taskMiddlewares.values())
      .filter((x) => Boolean(x.middleware.everywhere))
      .filter((x) => {
        if (typeof x.middleware.everywhere === "function") {
          return x.middleware.everywhere!(task);
        }

        return true;
      })
      .map((x) => x.middleware);
  }

  /**
   * Returns all global middleware for resource, which do not depend on the target resource.
   */
  getEverywhereMiddlewareForResources(
    target: IResource<any, any, any, any>,
  ): IResourceMiddleware[] {
    return Array.from(this.store.resourceMiddlewares.values())
      .filter((x) => Boolean(x.middleware.everywhere))
      .filter((x) => {
        if (typeof x.middleware.everywhere === "function") {
          return x.middleware.everywhere!(target);
        }

        return true;
      })
      .map((x) => x.middleware);
  }
}
