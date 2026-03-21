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
import type { TaskCallOptions } from "../../types/utilities";
import { composeReverseLayers } from "./composeLayers";
import {
  getTaskAbortSignalLink,
  retainActiveTaskAbortController,
  setTaskCallerSignal,
} from "../runtime/taskCancellation";
import { throwCancellationErrorFromSignal } from "../../tools/abortSignals";
import {
  extractRequestedId,
  resolveCanonicalIdFromStore,
  toCanonicalDefinitionFromStore,
} from "../StoreLookup";

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

  private resolveDefinitionId(reference: unknown): string {
    return (
      resolveCanonicalIdFromStore(this.store, reference) ??
      extractRequestedId(reference) ??
      String(reference)
    );
  }

  private toCanonicalDefinition<TDefinition extends { id: string }>(
    definition: TDefinition,
  ): TDefinition {
    return toCanonicalDefinitionFromStore(this.store, definition);
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
  ): (input: TInput, options?: TaskCallOptions) => Promise<Awaited<TOutput>> {
    const taskId = this.resolveDefinitionId(task);
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
    return ((input: TInput, options?: TaskCallOptions) => {
      const journal = options?.journal ?? new ExecutionJournalImpl();
      const cleanupTrackedTaskAbortController = retainActiveTaskAbortController(
        journal,
        (controller) => this.store.trackTaskAbortController(controller),
      );
      const cleanupCallerSignal = setTaskCallerSignal(journal, options?.signal);
      const executionSource =
        options?.source ?? runtimeSource.runtime("runtime-internal-taskRunner");
      return journaledRunner(input, journal, executionSource).finally(() => {
        cleanupCallerSignal();
        cleanupTrackedTaskAbortController();
      });
    }) as (
      input: TInput,
      options?: TaskCallOptions,
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
      const signalLink = getTaskAbortSignalLink(journal);
      const signal = signalLink.signal;

      if (signal?.aborted) {
        signalLink.cleanup();
        throwCancellationErrorFromSignal(signal);
      }

      const validatedInput = ValidationHelper.validateInput(
        input,
        task.inputSchema,
        this.resolveDefinitionId(task),
        "Task",
      );

      try {
        const rawResult = await this.store
          .getExecutionContextStore()
          .runWithSignal(signal, () =>
            task.run(validatedInput, storeTask.computedDependencies, {
              journal,
              source,
              signal,
            }),
          );

        return ValidationHelper.validateResult(
          rawResult,
          task.resultSchema,
          this.resolveDefinitionId(task),
          "Task",
        );
      } finally {
        signalLink.cleanup();
      }
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

    return composeReverseLayers(
      runner,
      storeTask.interceptors,
      (nextFunction, storedInterceptor) =>
        (async (
          input: TInput,
          journal: ExecutionJournal,
          source: RuntimeCallSource,
        ) =>
          storedInterceptor.interceptor(
            (inp) => nextFunction(inp, journal, source),
            input,
          )) as (
          input: TInput,
          journal: ExecutionJournal,
          source: RuntimeCallSource,
        ) => TOutput,
    );
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
    const canonicalTaskDefinition = this.toCanonicalDefinition(task);

    const createExecutionInput = (
      input: TInput,
      nextFunc: (...args: [inp?: TInput]) => Promise<Awaited<TOutput>>,
      journal: ExecutionJournal,
    ): ITaskMiddlewareExecutionInput<TInput, Awaited<TOutput>> => ({
      task: {
        definition: canonicalTaskDefinition,
        input: input,
      },
      next: nextFunc,
      journal,
    });

    return composeReverseLayers(
      runner,
      interceptors,
      (nextFunction, interceptor) =>
        (async (
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
            execution: ITaskMiddlewareExecutionInput<TInput, Awaited<TOutput>>,
          ): Promise<Awaited<TOutput>> => {
            return nextFunction(
              execution.task.input,
              journal,
              source,
            ) as Promise<Awaited<TOutput>>;
          };
          return interceptor(wrappedNext, executionInput) as TOutput;
        }) as (
          input: TInput,
          journal: ExecutionJournal,
          source: RuntimeCallSource,
        ) => TOutput,
    );
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

    const canonicalTaskDefinition = this.toCanonicalDefinition(task);

    return composeReverseLayers(
      runner,
      middlewares,
      (nextFunction, middleware) => {
        const middlewareId = this.store.findIdByDefinition(middleware);
        const storeMiddleware = this.store.taskMiddlewares.get(middlewareId)!;
        const middlewareSource = runtimeSource.taskMiddleware(middlewareId);

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
                    definition: canonicalTaskDefinition,
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

        const middlewareInterceptors =
          this.interceptorRegistry.getTaskMiddlewareInterceptors(middlewareId);

        return this.wrapWithInterceptors<TInput, TOutput, TDeps>(
          baseMiddlewareRunner as (
            input: TInput,
            journal: ExecutionJournal,
            source: RuntimeCallSource,
          ) => TOutput,
          middlewareInterceptors,
          task,
        );
      },
    );
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

    const canonicalTaskDefinition = this.toCanonicalDefinition(task);

    return composeReverseLayers(
      middlewareRunner,
      interceptors,
      (nextFunction, interceptor) =>
        (async (
          input: TInput,
          journal: ExecutionJournal,
          source: RuntimeCallSource,
        ) => {
          const executionInput: ITaskMiddlewareExecutionInput<
            TInput,
            Awaited<TOutput>
          > = {
            task: {
              definition: canonicalTaskDefinition,
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
            execution: ITaskMiddlewareExecutionInput<TInput, Awaited<TOutput>>,
          ): Promise<Awaited<TOutput>> => {
            return nextFunction(
              execution.task.input,
              journal,
              source,
            ) as Promise<Awaited<TOutput>>;
          };

          return interceptor(wrappedNext, executionInput) as TOutput;
        }) as (
          input: TInput,
          journal: ExecutionJournal,
          source: RuntimeCallSource,
        ) => TOutput,
    );
  }
}
