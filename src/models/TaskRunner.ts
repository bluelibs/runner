import { DependencyMapType, DependencyValuesType, ITask } from "../defs";
import { Errors } from "../errors";
import { EventManager } from "./EventManager";
import { globalEvents } from "../globals/globalEvents";
import { Store } from "./Store";
import { MiddlewareStoreElementType } from "./StoreTypes";
import { Logger } from "./Logger";
import { validateWithAdapter } from "../tools/validation";

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

    let error;
    try {
      // Validate input if a schema is provided
      if ((task as any).inputSchema) {
        try {
          // Mutate the input to the validated value so it flows into run and afterRun
          input = (await validateWithAdapter(
            (task as any).inputSchema,
            input
          )) as any;
        } catch (e: any) {
          throw Errors.validationFailed(
            "task.input",
            task.id,
            e?.issues ?? e?.details,
            e
          );
        }
      }

      // craft the next function starting from the first next function
      const result = {
        output: await runner(input),
      };
      const setOutput = (newOutput: any) => {
        result.output = newOutput;
      };

      // If it's a global event listener, we stop emitting so we don't get into an infinite loop.
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

      return result.output;
    } catch (e) {
      let isSuppressed = false;
      function suppress() {
        isSuppressed = true;
      }

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
  >(task: ITask<TInput, TOutput, TDeps>) {
    const storeTask = this.store.tasks.get(task.id);

    // this is the final next()
    let next = async (input: any) => {
      return task.run.call(null, input, storeTask?.computedDependencies as any);
    };

    const existingMiddlewares = task.middleware;
    const createdMiddlewares = [
      ...this.store.getEverywhereMiddlewareForTasks(
        existingMiddlewares.map((x) => x.id)
      ),
      ...existingMiddlewares,
    ];

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
        return storeMiddleware.middleware.run(
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
      };
    }

    return next;
  }
}
