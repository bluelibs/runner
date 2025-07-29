import {
  DependencyMapType,
  DependencyValuesType,
  ITask,
  IResource,
  IHookDefinition,
  IEventDefinition,
  IEvent,
} from "../defs";
import { Store } from "./Store";
import { ResourceStoreElementType, TaskStoreElementType } from "./StoreTypes";
import * as utils from "../define";
import { EventManager } from "./EventManager";
import { ResourceInitializer } from "./ResourceInitializer";
import { TaskRunner } from "./TaskRunner";
import { Errors } from "../errors";
import { Logger } from "./Logger";

/**
 * This class is responsible of setting up dependencies with their respective computedValues.
 * Note that all elements must have been previously registered otherwise errors will be thrown
 * when trying to depend on something not in the store.
 */
export class DependencyProcessor {
  protected readonly resourceInitializer: ResourceInitializer;

  constructor(
    protected readonly store: Store,
    protected readonly eventManager: EventManager,
    protected readonly taskRunner: TaskRunner,
    protected readonly logger: Logger
  ) {
    this.resourceInitializer = new ResourceInitializer(
      store,
      eventManager,
      logger
    );
  }

  /**
   * This function is going to go through all the resources, tasks and middleware to compute their required dependencies.
   */
  async computeAllDependencies() {
    for (const middleware of this.store.middlewares.values()) {
      const deps = middleware.middleware.dependencies as DependencyMapType;
      middleware.computedDependencies = await this.extractDependencies(
        deps,
        middleware.middleware.id
      );
    }

    for (const task of this.store.tasks.values()) {
      await this.computeTaskDependencies(task);
    }

    for (const resource of this.store.resources.values()) {
      await this.processResourceDependencies(resource);
    }

    // leftovers that were registered but not depended upon, except root
    // they should still be initialized as they might extend other
    await this.initializeUninitializedResources();
  }

  private async computeTaskDependencies(
    task: TaskStoreElementType<any, any, any>
  ) {
    const deps = task.task.dependencies as DependencyMapType;
    task.computedDependencies = await this.extractDependencies(
      deps,
      task.task.id
    );
  }

  // Most likely these are resources that no-one has dependencies towards
  // We need to ensure they work too!
  public async initializeUninitializedResources() {
    for (const resource of this.store.resources.values()) {
      if (
        resource.isInitialized === false &&
        // The root is the last one to be initialized and is done in a separate process.
        resource.resource.id !== this.store.root.resource.id
      ) {
        await this.processResourceDependencies(resource);
        const { value, context } =
          await this.resourceInitializer.initializeResource(
            resource.resource,
            resource.config,
            resource.computedDependencies as DependencyValuesType<{}>
          );
        resource.context = context;
        resource.value = value;
      }
    }
  }

  /**
   * Processes dependencies and hooks
   * @param resource
   */
  protected async processResourceDependencies(
    resource: ResourceStoreElementType<any, any, {}>
  ) {
    const deps = resource.resource.dependencies as DependencyMapType;
    resource.computedDependencies = await this.extractDependencies(
      deps,
      resource.resource.id
    );
  }

  public async initializeRoot() {
    const storeResource = this.store.root;

    const { value, context } =
      await this.resourceInitializer.initializeResource(
        storeResource.resource,
        storeResource.config,
        // They are already computed
        storeResource.computedDependencies as DependencyValuesType<{}>
      );

    storeResource.context = context;
    storeResource.value = value;
    storeResource.isInitialized = true;
  }

  /**
   * Processes all hooks, should run before emission of any event.
   */
  public attachListeners() {
    for (const task of this.store.tasks.values()) {
      if (task.task.on) {
        let eventDefinition = task.task.on;

        const handler = async (receivedEvent: IEvent<any>) => {
          if (receivedEvent.source === task.task.id) {
            // we don't want to trigger the same task that emitted the event
            // process.exit(0);
            return;
          }

          return this.taskRunner.run(
            task.task,
            receivedEvent,
            task.computedDependencies
          );
        };

        if (eventDefinition === "*") {
          this.eventManager.addGlobalListener(handler, {
            order: task.task.listenerOrder || 0,
          });
        } else {
          if (this.store.events.get(eventDefinition.id) === undefined) {
            throw Errors.eventNotFound(eventDefinition.id);
          }
          this.eventManager.addListener(eventDefinition, handler, {
            order: task.task.listenerOrder || 0,
          });
        }
      }
    }
  }

  async extractDependencies<T extends DependencyMapType>(
    map: T,
    source: string
  ): Promise<DependencyValuesType<T>> {
    const object = {} as DependencyValuesType<T>;

    for (const key in map) {
      object[key] = await this.extractDependency(map[key], source);
    }

    return object;
  }

  async extractDependency(object: any, source: string) {
    if (utils.isResource(object)) {
      return this.extractResourceDependency(object);
    } else if (utils.isTask(object)) {
      return this.extractTaskDependency(object);
    } else if (utils.isEvent(object)) {
      return this.extractEventDependency(object, source);
    } else {
      throw Errors.unknownItemType(object);
    }
  }

  /**
   * Converts the event into a running functions with real inputs
   * @param object
   * @returns
   */
  extractEventDependency(
    object: IEventDefinition<Record<string, any>>,
    source: string
  ) {
    return async (input: any) => {
      return this.eventManager.emit(object, input, source);
    };
  }

  async extractTaskDependency(object: ITask<any, any, {}>) {
    const storeTask = this.store.tasks.get(object.id);
    if (storeTask === undefined) {
      throw Errors.dependencyNotFound(`Task ${object.id}`);
    }

    if (!storeTask.isInitialized) {
      storeTask.isInitialized = true;

      // it's sanitised
      const dependencies = object.dependencies as DependencyMapType;

      storeTask.computedDependencies = await this.extractDependencies(
        dependencies,
        storeTask.task.id
      );
    }

    return (input: any) => {
      return this.taskRunner.run(
        storeTask.task,
        input,
        storeTask.computedDependencies
      );
    };
  }

  async extractResourceDependency(object: IResource<any, any, any>) {
    // check if it exists in the store with the value
    const storeResource = this.store.resources.get(object.id);
    if (storeResource === undefined) {
      throw Errors.dependencyNotFound(`Resource ${object.id}`);
    }

    const { resource, config } = storeResource;
    if (storeResource.isInitialized) {
      return storeResource.value;
    } else {
      // we need to initialize the resource
      storeResource.isInitialized = true;

      // check if it has an initialisation function that provides the value
      if (resource.init) {
        const { value, context } =
          await this.resourceInitializer.initializeResource(
            resource,
            config,
            await this.extractDependencies(
              resource.dependencies || {},
              resource.id
            )
          );

        storeResource.context = context;
        storeResource.value = value;
      }
    }

    return storeResource.value;
  }
}
