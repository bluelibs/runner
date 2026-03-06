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
import { RuntimeCallSource, runtimeSource } from "../../types/runtimeSource";
import { LifecycleAdmissionController } from "../runtime/LifecycleAdmissionController";

/**
 * Composes task execution chains with validation, interceptors, and middlewares.
 * Builds the onion-style wrapping of task runners.
 */
export class TaskMiddlewareComposer {
  private readonly lifecycleAdmissionController: LifecycleAdmissionController;

  constructor(
    private readonly store: Store,
    private readonly interceptorRegistry: InterceptorRegistry,
    private readonly middlewareResolver: MiddlewareResolver,
  ) {
    this.lifecycleAdmissionController =
      this.store.getLifecycleAdmissionController();
  }

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
    source?: RuntimeCallSource,
  ) => Promise<Awaited<TOutput>> {
    const taskId = this.store.resolveDefinitionId(task)!;
    const storeTask = this.store.tasks.get(taskId)!;
    const storeTaskDefinition = storeTask.task as ITask<TInput, TOutput, TDeps>;

    // Determine the effective task definition for this execution.
    // When RPC-routed, the Store task definition carries runtime routing overrides.
    const runnerTask = this.resolveTaskDefinition(task, storeTaskDefinition);

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
    return ((
      input: TInput,
      parentJournal?: ExecutionJournal,
      source?: RuntimeCallSource,
    ) => {
      const journal = parentJournal ?? new ExecutionJournalImpl();
      const executionSource =
        source ?? runtimeSource.runtime("runtime.internal.taskRunner");
      return journaledRunner(input, journal, executionSource);
    }) as (
      input: TInput,
      parentJournal?: ExecutionJournal,
      source?: RuntimeCallSource,
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
  ): (
    input: TInput,
    journal: ExecutionJournal,
    source: RuntimeCallSource,
  ) => TOutput {
    return (async (
      input: TInput,
      journal: ExecutionJournal,
      source: RuntimeCallSource,
    ) => {
      const validatedInput = ValidationHelper.validateInput(
        input,
        task.inputSchema,
        this.store.toPublicId(task),
        "Task",
      );

      const rawResult = await task.run(
        validatedInput,
        storeTask.computedDependencies,
        { journal, source },
      );

      return ValidationHelper.validateResult(
        rawResult,
        task.resultSchema,
        this.store.toPublicId(task),
        "Task",
      );
    }) as (
      input: TInput,
      journal: ExecutionJournal,
      source: RuntimeCallSource,
    ) => TOutput;
  }

  /**
   * Determines which task definition to use for execution
   * Prefers store definition when task is RPC-routed (runtime overrides apply)
   */
  private resolveTaskDefinition<T extends ITask<any, any, any>>(
    task: T,
    storeTask: T,
  ): T {
    const isRpcRouted = task.isRpcRouted || storeTask.isRpcRouted;
    return isRpcRouted ? storeTask : task;
  }

  /**
   * Applies local per-task interceptors (closest to the task)
   */
  private applyLocalInterceptors<TInput, TOutput extends Promise<any>>(
    runner: (
      input: TInput,
      journal: ExecutionJournal,
      source: RuntimeCallSource,
    ) => TOutput,
    storeTask: TaskStoreElementType,
  ): (
    input: TInput,
    journal: ExecutionJournal,
    source: RuntimeCallSource,
  ) => TOutput {
    if (!storeTask.interceptors || storeTask.interceptors.length === 0) {
      return runner;
    }

    let wrapped = runner;
    for (let i = storeTask.interceptors.length - 1; i >= 0; i--) {
      const interceptor = storeTask.interceptors[i].interceptor;
      const nextFunction = wrapped;
      wrapped = (async (
        input: TInput,
        journal: ExecutionJournal,
        source: RuntimeCallSource,
      ) => interceptor((inp) => nextFunction(inp, journal, source), input)) as (
        input: TInput,
        journal: ExecutionJournal,
        source: RuntimeCallSource,
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
    runner: (
      input: TInput,
      journal: ExecutionJournal,
      source: RuntimeCallSource,
    ) => TOutput,
    task: ITask<TInput, TOutput, TDeps>,
  ): (
    input: TInput,
    journal: ExecutionJournal,
    source: RuntimeCallSource,
  ) => TOutput {
    const interceptors = this.interceptorRegistry.getGlobalTaskInterceptors();
    if (interceptors.length === 0) {
      return runner;
    }
    const publicTaskDefinition = this.toPublicDefinition(task);

    const createExecutionInput = (
      input: TInput,
      nextFunc: (...args: [inp?: TInput]) => Promise<Awaited<TOutput>>,
      journal: ExecutionJournal,
    ): ITaskMiddlewareExecutionInput<TInput, Awaited<TOutput>> => ({
      task: {
        definition: publicTaskDefinition,
        input: input,
      },
      next: nextFunc,
      journal,
    });

    let currentNext = runner;

    for (let i = interceptors.length - 1; i >= 0; i--) {
      const interceptor = interceptors[i];
      const nextFunction = currentNext;

      currentNext = (async (
        input: TInput,
        journal: ExecutionJournal,
        source: RuntimeCallSource,
      ) => {
        const wrappedNextForInterceptor = (
          ...args: [inp?: TInput]
        ): Promise<Awaited<TOutput>> =>
          nextFunction(
            args.length > 0 ? (args[0] as TInput) : input,
            journal,
            source,
          ) as Promise<Awaited<TOutput>>;
        const executionInput = createExecutionInput(
          input,
          wrappedNextForInterceptor,
          journal,
        );
        const wrappedNext = (
          i: ITaskMiddlewareExecutionInput<TInput, Awaited<TOutput>>,
        ): Promise<Awaited<TOutput>> => {
          return nextFunction(i.task.input, journal, source) as Promise<
            Awaited<TOutput>
          >;
        };
        return interceptor(wrappedNext, executionInput) as TOutput;
      }) as (
        input: TInput,
        journal: ExecutionJournal,
        source: RuntimeCallSource,
      ) => TOutput;
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
    runner: (
      input: TInput,
      journal: ExecutionJournal,
      source: RuntimeCallSource,
    ) => TOutput,
    task: ITask<TInput, TOutput, TDeps>,
  ): (
    input: TInput,
    journal: ExecutionJournal,
    source: RuntimeCallSource,
  ) => TOutput {
    let middlewares =
      this.middlewareResolver.getApplicableTaskMiddlewares(task);

    // Apply rpc lane policy filter if needed
    middlewares = this.middlewareResolver.applyRpcLanePolicyFilter(
      task,
      middlewares,
    );

    if (middlewares.length === 0) {
      return runner;
    }

    let next = runner;
    const publicTaskDefinition = this.toPublicDefinition(task);

    // Layer middlewares (global first, then local), closest to the task runs last
    for (let i = middlewares.length - 1; i >= 0; i--) {
      const middleware = middlewares[i];
      const middlewareId = this.store.resolveDefinitionId(middleware)!;
      const storeMiddleware = this.store.taskMiddlewares.get(middlewareId)!;
      const nextFunction = next;
      const middlewareSource = runtimeSource.middleware(middlewareId);

      // Create base middleware runner (captures journal from closure)
      const baseMiddlewareRunner = async (
        input: TInput,
        journal: ExecutionJournal,
        source: RuntimeCallSource,
      ) => {
        return this.lifecycleAdmissionController.trackMiddlewareExecution(
          middlewareSource,
          () =>
            storeMiddleware.middleware.run(
              {
                task: {
                  definition: publicTaskDefinition,
                  input,
                },
                next: (...args: [TInput?]) =>
                  nextFunction(
                    args.length > 0 ? (args[0] as TInput) : input,
                    journal,
                    source,
                  ),
                journal,
              },
              storeMiddleware.computedDependencies,
              middleware.config,
            ),
        );
      };

      // Get and apply per-middleware interceptors
      const middlewareInterceptors =
        this.interceptorRegistry.getTaskMiddlewareInterceptors(middlewareId);

      next = this.wrapWithInterceptors<TInput, TOutput, TDeps>(
        baseMiddlewareRunner as (
          input: TInput,
          journal: ExecutionJournal,
          source: RuntimeCallSource,
        ) => TOutput,
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
    middlewareRunner: (
      input: TInput,
      journal: ExecutionJournal,
      source: RuntimeCallSource,
    ) => TOutput,
    interceptors: readonly TaskMiddlewareInterceptor[],
    task: ITask<TInput, TOutput, TDeps>,
  ): (
    input: TInput,
    journal: ExecutionJournal,
    source: RuntimeCallSource,
  ) => TOutput {
    if (interceptors.length === 0) {
      return middlewareRunner;
    }

    let wrapped = middlewareRunner;
    const publicTaskDefinition = this.toPublicDefinition(task);

    for (let i = interceptors.length - 1; i >= 0; i--) {
      const interceptor = interceptors[i];
      const nextFunction = wrapped;

      wrapped = (async (
        input: TInput,
        journal: ExecutionJournal,
        source: RuntimeCallSource,
      ) => {
        const executionInput: ITaskMiddlewareExecutionInput<
          TInput,
          Awaited<TOutput>
        > = {
          task: {
            definition: publicTaskDefinition,
            input: input,
          },
          next: (...args: [TInput?]) =>
            nextFunction(
              args.length > 0 ? (args[0] as TInput) : input,
              journal,
              source,
            ),
          journal,
        };

        const wrappedNext = (
          i: ITaskMiddlewareExecutionInput<TInput, Awaited<TOutput>>,
        ): Promise<Awaited<TOutput>> => {
          return nextFunction(i.task.input, journal, source) as Promise<
            Awaited<TOutput>
          >;
        };

        return interceptor(wrappedNext, executionInput) as TOutput;
      }) as (
        input: TInput,
        journal: ExecutionJournal,
        source: RuntimeCallSource,
      ) => TOutput;
    }

    return wrapped;
  }

  private toPublicDefinition<TTask extends ITask<any, any, any>>(
    task: TTask,
  ): TTask {
    const publicId = this.store.toPublicId(task);
    if (publicId === task.id) {
      return task;
    }

    return {
      ...task,
      id: publicId,
    };
  }
}
