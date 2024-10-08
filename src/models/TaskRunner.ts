import { DependencyMapType, DependencyValuesType, ITask } from "../defs";
import { Errors } from "../errors";
import { EventManager } from "./EventManager";
import { globalEvents } from "../globalEvents";
import {
  MiddlewareStoreElementType,
  Store,
  TaskStoreElementType,
} from "./Store";
import { Logger } from "./Logger";

export class TaskRunner {
  protected readonly runnerStore = new Map<
    string,
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
   * @param taskDependencies optional dependencies to be passed to the task, if not provided, the dependencies will be the ones already computed from the store.
   */
  public async run<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType
  >(
    task: ITask<TInput, TOutput, TDeps>,
    input: TInput,
    taskDependencies?: DependencyValuesType<TDeps>
  ): Promise<TOutput | undefined> {
    let runner = this.runnerStore.get(task.id);
    if (!runner) {
      const storeTask = this.store.tasks.get(task.id) as TaskStoreElementType;
      const deps = taskDependencies || storeTask.computedDependencies;

      runner = this.createRunnerWithMiddleware<TInput, TOutput, TDeps>(
        task,
        deps
      );

      this.runnerStore.set(task.id, runner);
    }

    // Suppress recursive triggering of beforeRun events
    if (task.id !== "global.beforeRunListener") {
      await this.eventManager.emit(task.events.beforeRun, { input }, task.id);

      await this.eventManager.emit(
        globalEvents.tasks.beforeRun,
        {
          task,
          input,
        },
        task.id
      );
    }

    let error;
    try {
      // craft the next function starting from the first next function
      const output = await runner(input);

      await this.eventManager.emit(
        task.events.afterRun,
        { input, output },
        task.id
      );
      await this.eventManager.emit(
        globalEvents.tasks.afterRun,
        {
          task,
          input,
          output,
        },
        task.id
      );

      return output;
    } catch (e) {
      let isSuppressed = false;
      const suppress = () => (isSuppressed = true);
      error = e;

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

      if (!isSuppressed) throw e;
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
  >(
    task: ITask<TInput, TOutput, TDeps>,
    taskDependencies: DependencyValuesType<{}>
  ) {
    // this is the final next()
    let next = async (input) => {
      this.logger.debug({
        message: `Running task ${task.id}`,
        input,
      });

      return task.run.call(null, input, taskDependencies as any);
    };

    const existingMiddlewares = task.middleware;
    const createdMiddlewares = [
      ...this.store.getGlobalMiddlewares(existingMiddlewares.map((x) => x.id)),
      ...existingMiddlewares,
    ];

    if (createdMiddlewares.length > 0) {
      // we need to run the middleware in reverse order
      // so we can chain the next function
      for (let i = createdMiddlewares.length - 1; i >= 0; i--) {
        const middleware = createdMiddlewares[i];
        const storeMiddleware = this.store.middlewares.get(
          middleware.id
        ) as MiddlewareStoreElementType; // we know it exists because at this stage all sanity checks have been done.

        const nextFunction = next;
        next = async (input) => {
          return storeMiddleware.middleware.run(
            {
              taskDefinition: task as any,
              input,
              next: nextFunction,
            },
            storeMiddleware.computedDependencies
          );
        };
      }
    }

    return next;
  }
}
