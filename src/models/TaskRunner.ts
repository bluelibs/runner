import { DependencyMapType, ITask, IHook, IEventEmission } from "../defs";
import { EventManager } from "./EventManager";
import { Store } from "./Store";
import { Logger } from "./Logger";
import { globalEvents } from "../globals/globalEvents";
import { globalTags } from "../globals/globalTags";
import { MiddlewareManager } from "./MiddlewareManager";

export class TaskRunner {
  protected readonly runnerStore = new Map<
    string | symbol,
    (input: any) => Promise<any>
  >();

  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager,
    protected readonly logger: Logger,
  ) {
    this.middlewareManager = new MiddlewareManager(
      this.store,
      this.eventManager,
      this.logger,
    );
  }

  private readonly middlewareManager: MiddlewareManager;

  /**
   * Begins the execution of an task. These are registered tasks and all sanity checks have been performed at this stage to ensure consistency of the object.
   * This function can throw only if any of the event listeners or run function throws
   * @param task the task to be run
   * @param input the input to be passed to the task
   */
  public async run<
    TInput,
    TOutput extends Promise<any>,
    TDeps extends DependencyMapType,
  >(
    task: ITask<TInput, TOutput, TDeps>,
    input?: TInput,
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
   * - globals.events.hookTriggered (before)
   * - globals.events.hookCompleted (after, with optional error)
   *
   * These observability events are tagged to be ignored by global listeners
   * and are not re-emitted for their own handlers to avoid recursion.
   */
  public async runHook<TPayload, TDeps extends DependencyMapType = {}>(
    hook: IHook<TDeps, any>,
    emission: IEventEmission<TPayload>,
  ): Promise<any> {
    // Hooks are stored in `store.hooks`; use their computed deps
    const deps = this.store.hooks.get(hook.id)?.computedDependencies as any;
    // Internal observability events are tagged to be excluded from global listeners.
    // We detect them by tag so we don't double-wrap them with our own hookTriggered/hookCompleted.
    const isObservabilityEvent =
      globalTags.excludeFromGlobalHooks.exists(emission);

    // The logic here is that we don't want to have lifecycle events for the events that are excluded from global ones.
    if (isObservabilityEvent) {
      return hook.run(emission as any, deps);
    }
    // Emit hookTriggered (excluded from global listeners)
    await this.eventManager.emit(
      globalEvents.hookTriggered,
      { hook, eventId: emission.id },
      hook.id,
    );

    try {
      const result = await hook.run(emission as any, deps);
      await this.eventManager.emit(
        globalEvents.hookCompleted,
        { hook, eventId: emission.id },
        hook.id,
      );
      return result;
    } catch (err: unknown) {
      try {
        await this.store.onUnhandledError?.({
          error: err,
          kind: "hook",
          source: hook.id,
        });
      } catch (_) {}
      await this.eventManager.emit(
        globalEvents.hookCompleted,
        {
          hook,
          eventId: emission.id,
          error: err as any,
        },
        hook.id,
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
    TDeps extends DependencyMapType,
  >(task: ITask<TInput, TOutput, TDeps>) {
    return this.middlewareManager.composeTaskRunner(task);
  }
}
