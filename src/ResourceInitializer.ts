import {
  DependencyMapType,
  DependencyValuesType,
  ITask,
  IResource,
} from "./defs";
import { EventManager } from "./EventManager";
import { globalEvents } from "./globalEvents";
import { Store } from "./Store";

export class ResourceInitializer {
  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager
  ) {}

  /**
   * Begins the execution of an task. These are registered tasks and all sanity checks have been performed at this stage to ensure consistency of the object.
   * This function can throw only if any of the event listeners or run function throws
   */
  public async initializeResource<
    TConfig = null,
    TValue = any,
    TDeps extends DependencyMapType = {}
  >(
    resource: IResource<TConfig, TValue, TDeps>,
    config: TConfig,
    dependencies: DependencyValuesType<TDeps>
  ): Promise<TValue | undefined> {
    // begin by dispatching the event of creating it.
    // then ensure the hooks are called
    // then ensure the middleware are called
    await this.eventManager.emit(globalEvents.resources.beforeInit, {
      config,
      resource,
    });
    await this.eventManager.emit(resource.events.beforeInit, { config });

    let error, value;
    try {
      if (resource.init) {
        value = await resource.init(config, dependencies);
      }

      await this.eventManager.emit(resource.events.afterInit, {
        config,
        value,
      });
      await this.eventManager.emit(globalEvents.resources.afterInit, {
        config,
        resource,
        value,
      });

      return value;
    } catch (e) {
      error = e;

      // If you want to rewthrow the error, this should be done inside the onError event.
      await this.eventManager.emit(resource.events.onError, { error });
      await this.eventManager.emit(globalEvents.resources.onError, {
        error,
        resource,
      });

      throw e;
    }
  }
}
