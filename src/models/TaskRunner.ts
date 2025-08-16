import {
  DependencyMapType,
  IMiddleware,
  ITask,
  IHook,
  IEventEmission,
} from "../defs";
import { EventManager } from "./EventManager";
import { Store } from "./Store";
import { MiddlewareStoreElementType } from "./StoreTypes";
import { Logger } from "./Logger";
import { ValidationError } from "../errors";
import { globalEvents } from "../globals/globalEvents";

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
    input?: TInput
  ): Promise<TOutput | undefined> {
    let runner = this.runnerStore.get(task.id);
    if (!runner) {
      runner = this.createRunnerWithMiddleware<TInput, TOutput, TDeps>(task);

      this.runnerStore.set(task.id, runner);
    }

    return await runner(input);
  }

  // Lifecycle emissions removed

  /**
   * Runs a hook (event listener) without any middleware.
   * Ensures dependencies are resolved from the hooks registry.
   *
   * Emits two internal observability events around the hook execution:
   * - global.hookTriggered (before)
   * - global.hookCompleted (after, with optional error)
   *
   * These observability events are tagged to be ignored by global listeners
   * and are not re-emitted for their own handlers to avoid recursion.
   */
  public async runHook<TPayload, TDeps extends DependencyMapType = {}>(
    hook: IHook<TDeps, any>,
    emission: IEventEmission<TPayload>
  ): Promise<any> {
    // Hooks are stored in `store.hooks`; use their computed deps
    const deps = this.store.hooks.get(hook.id)?.computedDependencies as any;
    const isObservabilityEvent =
      emission.id === globalEvents.hookTriggered.id ||
      emission.id === globalEvents.hookCompleted.id;

    if (isObservabilityEvent) {
      return hook.run(emission as any, deps);
    }
    // Emit hookTriggered (excluded from global listeners)
    await this.eventManager.emit(
      globalEvents.hookTriggered,
      { hookId: hook.id, eventId: emission.id },
      hook.id
    );

    try {
      const result = await hook.run(emission as any, deps);
      await this.eventManager.emit(
        globalEvents.hookCompleted,
        { hookId: hook.id, eventId: emission.id },
        hook.id
      );
      return result;
    } catch (err: any) {
      // Emit central error boundary for hook failures
      try {
        await this.eventManager.emit(
          globalEvents.unhandledError,
          { kind: "hook", id: hook.id, source: emission.id, error: err },
          hook.id
        );
      } catch (_) {}
      await this.eventManager.emit(
        globalEvents.hookCompleted,
        {
          hookId: hook.id,
          eventId: emission.id,
          error: err,
        },
        hook.id
      );
      throw err;
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
    const storeTask = this.store.tasks.get(task.id)!;

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

      // Resolve dependencies for tasks
      const deps = storeTask?.computedDependencies as any;

      try {
        return await task.run.call(null, input, deps);
      } catch (error) {
        // Emit central error boundary; still rethrow to caller
        try {
          await this.eventManager.emit(
            globalEvents.unhandledError,
            { kind: "task", id: task.id as any, error },
            task.id as any
          );
        } catch (_) {}
        throw error;
      }
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

    // Inject local per-task interceptors first (closest to the task)
    if (storeTask.interceptors && storeTask.interceptors.length > 0) {
      for (let i = storeTask.interceptors.length - 1; i >= 0; i--) {
        const interceptor = storeTask.interceptors[i];
        const nextFunction = next;
        next = async (input) => interceptor(nextFunction, input);
      }
    }

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
        let result: any;
        try {
          result = await storeMiddleware.middleware.run(
            {
              task: {
                definition: task,
                input,
              },
              next: nextFunction,
            },
            storeMiddleware.computedDependencies,
            middleware.config
          );

          return result;
        } catch (error) {
          // Emit unhandledError for middleware failures; still rethrow to caller
          try {
            await this.eventManager.emit(
              globalEvents.unhandledError,
              { kind: "middleware", id: middleware.id, error },
              middleware.id
            );
          } catch (_) {}
          throw error;
        }
      };
    }

    return next;
  }
}
