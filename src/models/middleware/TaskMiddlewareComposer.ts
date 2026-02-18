import { ITask, DependencyMapType } from "../../defs";
import { Store } from "../Store";
import { InterceptorRegistry } from "./InterceptorRegistry";
import { MiddlewareResolver } from "./MiddlewareResolver";
import { ValidationHelper } from "./ValidationHelper";
import { TaskStoreElementType } from "../../types/storeTypes";
import { ITaskMiddlewareExecutionInput } from "../../types/taskMiddleware";
import { ExecutionJournalImpl } from "../ExecutionJournal";
import type { ExecutionJournal } from "../../types/executionJournal";
import type { TaskMiddlewareInterceptor } from "./types";

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
  ): (
    input: TInput,
    parentJournal?: ExecutionJournal,
  ) => Promise<Awaited<TOutput>> {
    const storeTask = this.store.tasks.get(task.id)!;

    // Determine the effective task definition for this execution.
    // When tunneled, the Store task definition carries tunnel overrides and metadata.
    const runnerTask = this.resolveTaskDefinition(task, storeTask.task);

    // 1. Base runner with validation (receives input + journal)
    let runner = this.createBaseRunner(runnerTask, storeTask);

    // 2. Apply local task interceptors
    runner = this.applyLocalInterceptors(runner, storeTask);

    // 3. Apply middleware layers
    runner = this.applyMiddlewares(runner, runnerTask);

    // 4. Apply global task interceptors (outermost).
    // This ensures they still run even if a middleware short-circuits (eg. caching).
    runner = this.applyGlobalInterceptors(runner, runnerTask);

    // 5. Outer wrapper: use provided journal or create new one
    const journaledRunner = runner;
    return ((input: TInput, parentJournal?: ExecutionJournal) => {
      const journal = parentJournal ?? new ExecutionJournalImpl();
      return journaledRunner(input, journal);
    }) as (
      input: TInput,
      parentJournal?: ExecutionJournal,
    ) => Promise<Awaited<TOutput>>;
  }

  /**
   * Creates the base task runner with input/result validation
   */
  private createBaseRunner<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType,
  >(
    task: ITask<TInput, TOutput, TDeps>,
    storeTask: TaskStoreElementType,
  ): (input: TInput, journal: ExecutionJournal) => TOutput {
    return (async (input: TInput, journal: ExecutionJournal) => {
      const validatedInput = ValidationHelper.validateInput(
        input,
        task.inputSchema,
        task.id,
        "Task",
      );

      const rawResult = await task.run(
        validatedInput,
        storeTask.computedDependencies,
        { journal },
      );

      return ValidationHelper.validateResult(
        rawResult,
        task.resultSchema,
        task.id,
        "Task",
      );
    }) as (input: TInput, journal: ExecutionJournal) => TOutput;
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
  private applyLocalInterceptors<TInput, TOutput extends Promise<any>>(
    runner: (input: TInput, journal: ExecutionJournal) => TOutput,
    storeTask: TaskStoreElementType,
  ): (input: TInput, journal: ExecutionJournal) => TOutput {
    if (!storeTask.interceptors || storeTask.interceptors.length === 0) {
      return runner;
    }

    let wrapped = runner;
    for (let i = storeTask.interceptors.length - 1; i >= 0; i--) {
      const interceptor = storeTask.interceptors[i];
      const nextFunction = wrapped;
      wrapped = (async (input: TInput, journal: ExecutionJournal) =>
        interceptor((inp) => nextFunction(inp, journal), input)) as (
        input: TInput,
        journal: ExecutionJournal,
      ) => TOutput;
    }

    return wrapped;
  }

  /**
   * Applies global task middleware interceptors
   */
  private applyGlobalInterceptors<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType,
  >(
    runner: (input: TInput, journal: ExecutionJournal) => TOutput,
    task: ITask<TInput, TOutput, TDeps>,
  ): (input: TInput, journal: ExecutionJournal) => TOutput {
    const interceptors = this.interceptorRegistry.getGlobalTaskInterceptors();
    if (interceptors.length === 0) {
      return runner;
    }

    const createExecutionInput = (
      input: TInput,
      nextFunc: (inp?: TInput) => Promise<Awaited<TOutput>>,
      journal: ExecutionJournal,
    ): ITaskMiddlewareExecutionInput<TInput, Awaited<TOutput>> => ({
      task: {
        definition: task,
        input: input,
      },
      next: nextFunc,
      journal,
    });

    let currentNext = runner;

    for (let i = interceptors.length - 1; i >= 0; i--) {
      const interceptor = interceptors[i];
      const nextFunction = currentNext;

      currentNext = (async (input: TInput, journal: ExecutionJournal) => {
        const wrappedNextForInterceptor = (
          inp?: TInput,
        ): Promise<Awaited<TOutput>> =>
          nextFunction(inp === undefined ? input : inp, journal) as Promise<
            Awaited<TOutput>
          >;
        const executionInput = createExecutionInput(
          input,
          wrappedNextForInterceptor,
          journal,
        );
        const wrappedNext = (
          i: ITaskMiddlewareExecutionInput<TInput, Awaited<TOutput>>,
        ): Promise<Awaited<TOutput>> => {
          return nextFunction(i.task.input, journal) as Promise<
            Awaited<TOutput>
          >;
        };
        return interceptor(wrappedNext, executionInput) as TOutput;
      }) as (input: TInput, journal: ExecutionJournal) => TOutput;
    }

    return currentNext;
  }

  /**
   * Applies task middleware layers (global first, then local)
   */
  private applyMiddlewares<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType,
  >(
    runner: (input: TInput, journal: ExecutionJournal) => TOutput,
    task: ITask<TInput, TOutput, TDeps>,
  ): (input: TInput, journal: ExecutionJournal) => TOutput {
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

      // Create base middleware runner (captures journal from closure)
      const baseMiddlewareRunner = async (
        input: TInput,
        journal: ExecutionJournal,
      ) => {
        return storeMiddleware.middleware.run(
          {
            task: {
              definition: task,
              input,
            },
            next: (...args: [TInput?]) =>
              nextFunction(
                args.length > 0 ? (args[0] as TInput) : input,
                journal,
              ),
            journal,
          },
          storeMiddleware.computedDependencies,
          middleware.config,
        );
      };

      // Get and apply per-middleware interceptors
      const middlewareInterceptors =
        this.interceptorRegistry.getTaskMiddlewareInterceptors(middleware.id);

      next = this.wrapWithInterceptors<TInput, TOutput, TDeps>(
        baseMiddlewareRunner as any,
        middlewareInterceptors,
        task,
      );
    }

    return next;
  }

  /**
   * Wraps a middleware runner with its specific interceptors in onion style
   */
  private wrapWithInterceptors<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType,
  >(
    middlewareRunner: (input: TInput, journal: ExecutionJournal) => TOutput,
    interceptors: readonly TaskMiddlewareInterceptor[],
    task: ITask<TInput, TOutput, TDeps>,
  ): (input: TInput, journal: ExecutionJournal) => TOutput {
    if (interceptors.length === 0) {
      return middlewareRunner;
    }

    let wrapped = middlewareRunner;

    for (let i = interceptors.length - 1; i >= 0; i--) {
      const interceptor = interceptors[i];
      const nextFunction = wrapped;

      wrapped = (async (input: TInput, journal: ExecutionJournal) => {
        const executionInput: ITaskMiddlewareExecutionInput<
          TInput,
          Awaited<TOutput>
        > = {
          task: {
            definition: task,
            input: input,
          },
          next: (...args: [TInput?]) =>
            nextFunction(
              args.length > 0 ? (args[0] as TInput) : input,
              journal,
            ),
          journal,
        };

        const wrappedNext = (
          i: ITaskMiddlewareExecutionInput<TInput, Awaited<TOutput>>,
        ): Promise<Awaited<TOutput>> => {
          return nextFunction(i.task.input, journal) as Promise<
            Awaited<TOutput>
          >;
        };

        return interceptor(wrappedNext, executionInput) as TOutput;
      }) as (input: TInput, journal: ExecutionJournal) => TOutput;
    }

    return wrapped;
  }
}
