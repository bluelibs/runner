import {
  DependencyMapType,
  DependencyValuesType,
  IMiddleware,
  ITask,
} from "../defs";
import { EventManager } from "./EventManager";
import { globalEvents } from "../globals/globalEvents";
import { Store } from "./Store";
import { MiddlewareStoreElementType } from "./StoreTypes";
import { Logger } from "./Logger";
import { ValidationError } from "../errors";

export class TaskRunner {
  protected readonly runnerStore = new Map<
    string | symbol,
    (input: any) => Promise<any>
  >();

  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger
  ) {}

  /**
   * Begins the execution of an task. These are registered tasks and all sanity checks have been performed at this stage to ensure consistency of the object.
   * This function can throw only if any of the event listeners or run function throws
   * @param task the task to be run
   * @param input the input to be passed to the task
   */
  public async run<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType
  >(
    task: ITask<TInput, TOutput, TDeps>,
    input: TInput
  ): Promise<TOutput | undefined> {
    let runner = this.runnerStore.get(task.id);
    if (!runner) {
      runner = this.createRunnerWithMiddleware<TInput, TOutput, TDeps>(task);

      this.runnerStore.set(task.id, runner);
    }

    const isGlobalEventListener = task.on === "*";

    await this.emitTaskEventsBeforeRun<TInput, TOutput, TDeps>(
      isGlobalEventListener,
      task,
      input
    );

    try {
      // craft the next function starting from the first next function
      const result = {
        output: await runner(input),
      };
      // If it's a global event listener, we stop emitting so we don't get into an infinite loop.
      await this.emitTaskEventsAfterRun<TInput, TOutput, TDeps>(
        isGlobalEventListener,
        task,
        input,
        result
      );

      return result.output;
    } catch (error) {
      let isSuppressed = await this.emitTaskOnErrorEvents<
        TInput,
        TOutput,
        TDeps
      >(task, error);

      if (!isSuppressed) throw error;
    }
  }

  private async emitTaskOnErrorEvents<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType
  >(task: ITask<TInput, TOutput, TDeps, undefined, any>, error: unknown) {
    let isSuppressed = false;
    function suppress() {
      isSuppressed = true;
    }

    // If you want to rewthrow the error, this should be done inside the onError event.
    await this.eventManager.emit(
      task.events.onError,
      { error, suppress },
      task.id
    );
    await this.eventManager.emit(
      globalEvents.tasks.onError,
      {
        task,
        error,
        suppress,
      },
      task.id
    );

    return isSuppressed;
  }

  private async emitTaskEventsAfterRun<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType
  >(
    isGlobalEventListener: boolean,
    task: ITask<TInput, TOutput, TDeps, undefined, any>,
    input: TInput,
    result: { output: any }
  ) {
    const setOutput = (newOutput: any) => {
      result.output = newOutput;
    };

    if (!isGlobalEventListener) {
      await this.eventManager.emit(
        task.events.afterRun,
        {
          input,
          get output() {
            return result.output;
          },
          setOutput,
        },
        task.id
      );
    }

    if (
      !isGlobalEventListener &&
      task.on !== globalEvents.tasks.beforeRun &&
      task.on !== globalEvents.tasks.afterRun
    ) {
      // If it's a lifecycle listener we prevent from emitting further events.
      await this.eventManager.emit(
        globalEvents.tasks.afterRun,
        {
          task,
          input,
          get output() {
            return result.output;
          },
          setOutput,
        },
        task.id
      );
    }
  }

  private async emitTaskEventsBeforeRun<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType
  >(
    isGlobalEventListener: boolean,
    task: ITask<TInput, TOutput, TDeps, undefined, any>,
    input: TInput
  ) {
    if (!isGlobalEventListener) {
      await this.eventManager.emit(task.events.beforeRun, { input }, task.id);
    }

    if (
      !isGlobalEventListener &&
      task.on !== globalEvents.tasks.beforeRun &&
      task.on !== globalEvents.tasks.afterRun
    ) {
      await this.eventManager.emit(
        globalEvents.tasks.beforeRun,
        {
          task,
          input,
        },
        task.id
      );
    }
  }

  /**
   * Creates the function with the chain of middleware.
   * @param task
   * @param input
   * @param taskDependencies
   * @returns
   */
  protected createRunnerWithMiddleware<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType
  >(task: ITask<TInput, TOutput, TDeps>) {
    const storeTask = this.store.tasks.get(task.id);
    const isGlobalEventListener = task.on === "*";

    // this is the final next()
    let next = async (input: any) => {
      // Validate input with schema if provided
      if (task.inputSchema) {
        try {
          input = task.inputSchema.parse(input);
        } catch (error) {
          throw new ValidationError(
            "Task input",
            task.id,
            error instanceof Error ? error : new Error(String(error))
          );
        }
      }

      return task.run.call(null, input, storeTask?.computedDependencies as any);
    };

    const existingMiddlewares = task.middleware;
    const existingMiddlewareIds = existingMiddlewares.map((x) => x.id);
    // The logic here is that we want to attach the middleware only once, so we filter out the ones that are already attached at the task level.
    // This allows a very flexible approach, you can have a global middleware that has a specific config for the rest, but for a specific task, you can override it.
    // This enables a very powerful approach to middleware.
    const globalMiddlewares = this.store
      .getEverywhereMiddlewareForTasks(task)
      .filter((x) => !existingMiddlewareIds.includes(x.id));
    const createdMiddlewares = [...globalMiddlewares, ...existingMiddlewares];

    if (createdMiddlewares.length === 0) {
      return next;
    }

    // we need to run the middleware in reverse order
    // so we can chain the next function
    for (let i = createdMiddlewares.length - 1; i >= 0; i--) {
      const middleware = createdMiddlewares[i];
      const storeMiddleware = this.store.middlewares.get(
        middleware.id
      ) as MiddlewareStoreElementType; // we know it exists because at this stage all sanity checks have been done.

      const nextFunction = next;
      next = async (input) => {
        // Do not launch anymore events if the task at hand is a global event listener.
        if (!isGlobalEventListener) {
          await this.emitMiddlewareEventsBeforeRun<TInput, TOutput, TDeps>(
            middleware,
            task,
            input
          );
        }

        let result: any;
        try {
          result = await storeMiddleware.middleware.run(
            {
              task: {
                definition: task as any,
                input,
              },
              next: nextFunction,
            },
            storeMiddleware.computedDependencies,
            middleware.config
          );
          if (!isGlobalEventListener) {
            await this.emitMiddlewareEventsAfterRun<TInput, TOutput, TDeps>(
              middleware,
              task,
              input
            );
          }

          return result;
        } catch (error) {
          if (!isGlobalEventListener) {
            let isSuppressed = await this.emitMiddlewareEventsOnError<
              TInput,
              TOutput,
              TDeps
            >(middleware, error, task, input);

            if (!isSuppressed) throw error;
          } else {
            throw error;
          }
        }
      };
    }

    return next;
  }

  private async emitMiddlewareEventsOnError<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType
  >(
    middleware: IMiddleware<any, any>,
    error: unknown,
    task: ITask<TInput, TOutput, TDeps, undefined, any>,
    input: any
  ) {
    let isSuppressed = false;
    function suppress() {
      isSuppressed = true;
    }
    await this.eventManager.emit(
      middleware.events.onError,
      { error, suppress, task: { definition: task, input } },
      task.id
    );
    await this.eventManager.emit(
      globalEvents.middlewares.onError,
      { middleware, task: { definition: task, input }, error, suppress },
      task.id
    );
    return isSuppressed;
  }

  private async emitMiddlewareEventsAfterRun<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType
  >(
    middleware: IMiddleware<any, any>,
    task: ITask<TInput, TOutput, TDeps, undefined, any>,
    input: any
  ) {
    await this.eventManager.emit(
      middleware.events.afterRun,
      {
        task: { definition: task, input },
      },
      task.id
    );
    await this.eventManager.emit(
      globalEvents.middlewares.afterRun,
      { middleware, task: { definition: task, input } },
      middleware.id
    );
  }

  private async emitMiddlewareEventsBeforeRun<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType
  >(
    middleware: IMiddleware<any, any>,
    task: ITask<TInput, TOutput, TDeps, undefined, any>,
    input: any
  ) {
    await this.eventManager.emit(
      middleware.events.beforeRun,
      {
        task: { definition: task, input },
      },
      middleware.id
    );
    await this.eventManager.emit(
      globalEvents.middlewares.beforeRun,
      { middleware, task: { definition: task, input } },
      middleware.id
    );
  }
}
