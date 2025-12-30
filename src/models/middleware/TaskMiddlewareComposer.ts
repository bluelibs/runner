import { ITask, DependencyMapType } from "../../defs";
import { Store } from "../Store";
import { InterceptorRegistry } from "./InterceptorRegistry";
import { MiddlewareResolver } from "./MiddlewareResolver";
import { ValidationHelper } from "./ValidationHelper";
import { TaskStoreElementType } from "../../types/storeTypes";
import { ITaskMiddlewareExecutionInput } from "../../types/taskMiddleware";

/**
 * Composes task execution chains with validation, interceptors, and middlewares.
 * Builds the onion-style wrapping of task runners.
 */
export class TaskMiddlewareComposer {
  constructor(
    private readonly store: Store,
    private readonly interceptorRegistry: InterceptorRegistry,
    private readonly middlewareResolver: MiddlewareResolver,
  ) {}

  /**
   * Composes a complete task runner with all middleware and interceptors applied
   */
  compose<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType,
  >(
    task: ITask<TInput, TOutput, TDeps>,
  ): (input: TInput) => Promise<Awaited<TOutput>> {
    const storeTask = this.store.tasks.get(task.id)!;

    // 1. Base runner with validation
    let runner = this.createBaseRunner(task, storeTask);

    // 2. Apply local task interceptors
    runner = this.applyLocalInterceptors(runner, storeTask);

    // 3. Apply global task interceptors
    runner = this.applyGlobalInterceptors(runner, task);

    // 4. Apply middleware layers
    runner = this.applyMiddlewares(runner, task, storeTask);

    return runner as (input: TInput) => Promise<Awaited<TOutput>>;
  }

  /**
   * Creates the base task runner with input/result validation
   */
  private createBaseRunner<TInput, TOutput extends Promise<any>>(
    task: ITask<TInput, TOutput, any>,
    storeTask: TaskStoreElementType,
  ): (input: any) => Promise<any> {
    return async (input: any) => {
      const runnerTask = this.resolveTaskDefinition(task, storeTask.task);

      const validatedInput = ValidationHelper.validateInput(
        input,
        runnerTask.inputSchema,
        runnerTask.id,
        "Task",
      );

      const rawResult = await runnerTask.run(
        validatedInput,
        storeTask.computedDependencies,
      );

      return ValidationHelper.validateResult(
        rawResult,
        runnerTask.resultSchema,
        runnerTask.id,
        "Task",
      );
    };
  }

  /**
   * Determines which task definition to use for execution
   * Prefers store definition when task is tunneled (tunnel overrides apply)
   */
  private resolveTaskDefinition<T extends ITask<any, any, any>>(
    task: T,
    storeTask: T,
  ): T {
    const isLocallyTunneled = task.isTunneled || storeTask.isTunneled;
    return isLocallyTunneled ? storeTask : task;
  }

  /**
   * Applies local per-task interceptors (closest to the task)
   */
  private applyLocalInterceptors(
    runner: (input: any) => Promise<any>,
    storeTask: TaskStoreElementType,
  ): (input: any) => Promise<any> {
    if (!storeTask.interceptors || storeTask.interceptors.length === 0) {
      return runner;
    }

    let wrapped = runner;
    for (let i = storeTask.interceptors.length - 1; i >= 0; i--) {
      const interceptor = storeTask.interceptors[i];
      const nextFunction = wrapped;
      wrapped = async (input) => interceptor(nextFunction, input);
    }

    return wrapped;
  }

  /**
   * Applies global task middleware interceptors
   */
  private applyGlobalInterceptors(
    runner: (input: any) => Promise<any>,
    task: ITask<any, any, any>,
  ): (input: any) => Promise<any> {
    const interceptors = this.interceptorRegistry.getGlobalTaskInterceptors();
    if (interceptors.length === 0) {
      return runner;
    }

    const reversedInterceptors = [...interceptors].reverse();

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

    let currentNext = runner;

    for (let i = reversedInterceptors.length - 1; i >= 0; i--) {
      const interceptor = reversedInterceptors[i];
      const nextFunction = currentNext;

      currentNext = async (input) => {
        const executionInput = createExecutionInput(input, nextFunction);
        const wrappedNext = (
          i: ITaskMiddlewareExecutionInput<any>,
        ): Promise<any> => {
          return nextFunction(i.task.input);
        };
        return interceptor(wrappedNext, executionInput);
      };
    }

    return currentNext;
  }

  /**
   * Applies task middleware layers (global first, then local)
   */
  private applyMiddlewares(
    runner: (input: any) => Promise<any>,
    task: ITask<any, any, any>,
    storeTask: TaskStoreElementType,
  ): (input: any) => Promise<any> {
    const tDef = storeTask.task;
    let middlewares =
      this.middlewareResolver.getApplicableTaskMiddlewares(task);

    // Apply tunnel policy filter if needed
    middlewares = this.middlewareResolver.applyTunnelPolicyFilter(
      task,
      middlewares,
    );

    if (middlewares.length === 0) {
      return runner;
    }

    let next = runner;

    // Layer middlewares (global first, then local), closest to the task runs last
    for (let i = middlewares.length - 1; i >= 0; i--) {
      const middleware = middlewares[i];
      const storeMiddleware = this.store.taskMiddlewares.get(middleware.id)!;
      const nextFunction = next;

      // Create base middleware runner
      const baseMiddlewareRunner = async (input: any) => {
        return storeMiddleware.middleware.run(
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
      };

      // Get and apply per-middleware interceptors
      const middlewareInterceptors =
        this.interceptorRegistry.getTaskMiddlewareInterceptors(middleware.id);

      next = this.wrapWithInterceptors(
        baseMiddlewareRunner,
        middlewareInterceptors,
      );
    }

    return next;
  }

  /**
   * Wraps a middleware runner with its specific interceptors in onion style
   */
  private wrapWithInterceptors(
    middlewareRunner: (input: any) => Promise<any>,
    interceptors: Array<(next: any, input: any) => Promise<any>>,
  ): (input: any) => Promise<any> {
    if (interceptors.length === 0) {
      return middlewareRunner;
    }

    const reversedInterceptors = [...interceptors].reverse();
    let wrapped = middlewareRunner;

    for (let i = reversedInterceptors.length - 1; i >= 0; i--) {
      const interceptor = reversedInterceptors[i];
      const nextFunction = wrapped;

      wrapped = async (input: any) => {
        const executionInput: ITaskMiddlewareExecutionInput<any> = {
          task: {
            definition: null as any,
            input: input,
          },
          next: nextFunction as any,
        };

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
}
