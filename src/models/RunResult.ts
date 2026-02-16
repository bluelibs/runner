import {
  DependencyMapType,
  IEvent,
  IEventEmitOptions,
  IEventEmitReport,
  ITask,
} from "../defs";
import { IResource } from "../defs";
// For RunResult convenience API, preserve the original simple messages
import { EventManager } from "./EventManager";
import { Logger } from "./Logger";
import { Store } from "./Store";
import { TaskRunner } from "./TaskRunner";

export class RunResult<V> {
  #disposed = false;
  #disposing = false;
  #disposePromise: Promise<void> | undefined;

  constructor(
    public readonly value: V,
    public readonly logger: Logger,
    public readonly store: Store,
    private readonly eventManager: EventManager,
    private readonly taskRunner: TaskRunner,
    private readonly disposeFn: () => Promise<void>,
  ) {}

  private ensureRuntimeIsActive() {
    if (this.#disposed || this.#disposing) {
      throw new Error("RunResult has been disposed.");
    }
  }

  /**
   * Run a task within the context of the run result.
   * @param task - The task to run.
   * @param args - The arguments to pass to the task.
   * @returns The result of the task.
   */
  public runTask = <
    I = undefined,
    O extends Promise<any> = any,
    D extends DependencyMapType = DependencyMapType,
  >(
    task: ITask<I, O, D> | string,
    ...args: I extends undefined | void ? [] : [I]
  ) => {
    this.ensureRuntimeIsActive();

    if (typeof task === "string") {
      const taskId = task;
      if (!this.store.tasks.has(taskId)) {
        throw new Error(`Task "${taskId}" not found.`);
      }
      task = this.store.tasks.get(taskId)!.task;
    }

    return this.taskRunner.run(task, ...args);
  };

  /**
   * Emit an event within the context of the run result.
   * @param event - The event to emit.
   * @param payload - The payload to emit.
   */
  public emitEvent = (<P>(
    event: IEvent<P> | string,
    payload?: P extends undefined | void ? undefined : P,
    options?: IEventEmitOptions,
  ) => {
    this.ensureRuntimeIsActive();

    if (typeof event === "string") {
      const eventId = event;
      if (!this.store.events.has(eventId)) {
        throw new Error(`Event "${eventId}" not found.`);
      }
      event = this.store.events.get(eventId)!.event;
    }
    return this.eventManager.emit(event, payload, "outside", options);
  }) as {
    <P>(
      event: IEvent<P> | string,
      payload?: P extends undefined | void ? undefined : P,
    ): Promise<void>;
    <P>(
      event: IEvent<P> | string,
      payload: P extends undefined | void ? undefined : P,
      options: IEventEmitOptions & { report: true },
    ): Promise<IEventEmitReport>;
    <P>(
      event: IEvent<P> | string,
      payload?: P extends undefined | void ? undefined : P,
      options?: IEventEmitOptions,
    ): Promise<void | IEventEmitReport>;
  };

  /**
   * Get the value of a resource from the run result.
   * @param resource - The resource to get the value of.
   * @returns The value of the resource.
   */
  public getResourceValue = <Output extends Promise<any>>(
    resource: string | IResource<any, Output, any, any, any>,
  ): Output extends Promise<infer U> ? U : Output => {
    this.ensureRuntimeIsActive();

    const resourceId = typeof resource === "string" ? resource : resource.id;
    if (!this.store.resources.has(resourceId)) {
      throw new Error(`Resource "${resourceId}" not found.`);
    }

    return this.store.resources.get(resourceId)!.value;
  };

  /**
   * Get the config of a resource from the run result.
   * @param resource - The resource to get the config of.
   * @returns The config passed for the resource.
   */
  public getResourceConfig = <Config>(
    resource: string | IResource<Config, any, any, any, any>,
  ): Config => {
    this.ensureRuntimeIsActive();

    const resourceId = typeof resource === "string" ? resource : resource.id;
    if (!this.store.resources.has(resourceId)) {
      throw new Error(`Resource "${resourceId}" not found.`);
    }

    return this.store.resources.get(resourceId)!.config;
  };

  public dispose = () => {
    if (this.#disposed) {
      return Promise.resolve();
    }

    if (this.#disposePromise) {
      return this.#disposePromise;
    }

    this.#disposing = true;

    this.#disposePromise = Promise.resolve()
      .then(() => this.disposeFn())
      .then(() => {
        this.#disposed = true;
      })
      .finally(() => {
        this.#disposing = false;
        this.#disposePromise = undefined;
      });

    return this.#disposePromise;
  };
}
