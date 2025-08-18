import { DependencyMapType, IEvent, ITask } from "../defs";
import { IResource } from "../defs";
import { ResourceNotFoundError, RuntimeError } from "../errors";
import { EventManager } from "./EventManager";
import { Logger } from "./Logger";
import { Store } from "./Store";
import { TaskRunner } from "./TaskRunner";
import { OnUnhandledError } from "./UnhandledError";

export class RunResult<V> {
  constructor(
    public readonly value: V,
    public readonly logger: Logger,
    private readonly store: Store,
    private readonly eventManager: EventManager,
    private readonly taskRunner: TaskRunner,
    private readonly disposeFn: () => Promise<void>,
  ) {}

  /**
   * Run a task within the context of the run result.
   * @param task - The task to run.
   * @param args - The arguments to pass to the task.
   * @returns The result of the task.
   */
  public runTask = <
    I = undefined,
    O extends Promise<any> = any,
    D extends DependencyMapType = any,
  >(
    task: ITask<I, O, D> | string,
    ...args: I extends undefined | void ? [] : [I]
  ) => {
    if (typeof task === "string") {
      const taskId = task;
      if (!this.store.tasks.has(taskId)) {
        throw new RuntimeError(`Task "${taskId}" not found.`);
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
  public emitEvent = <P>(
    event: IEvent<P> | string,
    payload?: P extends undefined | void ? undefined : P,
  ) => {
    if (typeof event === "string") {
      const eventId = event;
      if (!this.store.events.has(eventId)) {
        throw new RuntimeError(`Event "${eventId}" not found.`);
      }
      event = this.store.events.get(eventId)!.event;
    }
    return this.eventManager.emit(event, payload, "outside");
  };

  /**
   * Get the value of a resource from the run result.
   * @param resource - The resource to get the value of.
   * @returns The value of the resource.
   */
  public getResourceValue = <Output extends Promise<any>>(
    resource: string | IResource<any, Output, any, any, any>,
  ) => {
    const resourceId = typeof resource === "string" ? resource : resource.id;
    if (!this.store.resources.has(resourceId)) {
      throw new ResourceNotFoundError(
        `Resource "${resourceId}" not found. Did you forget to register it or are you using the correct id?`,
      );
    }

    return this.store.resources.get(resourceId)!.value;
  };

  public dispose = () => {
    return this.disposeFn();
  };
}
