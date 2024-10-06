import {
  DependencyMapType,
  DependencyValuesType,
  ITask,
  IResource,
  IHookDefinition,
  IEventDefinition,
} from "../defs";
import { ResourceStoreElementType, Store, TaskStoreElementType } from "./Store";
import * as utils from "../define";
import { EventManager } from "./EventManager";
import { ResourceInitializer } from "./ResourceInitializer";
import { TaskRunner } from "./TaskRunner";
import { Errors } from "../errors";

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
    protected readonly taskRunner: TaskRunner
  ) {
    this.resourceInitializer = new ResourceInitializer(store, eventManager);
  }

  /**
   * This function is going to go through all the resources, tasks and middleware to compute their required dependencies.
   */
  async computeAllDependencies() {
    for (const middleware of this.store.middlewares.values()) {
      const deps = middleware.middleware.dependencies as DependencyMapType;
      middleware.computedDependencies = await this.extractDependencies(deps);
    }

    for (const task of this.store.tasks.values()) {
      await this.computeTaskDependencies(task);
    }

    for (const resource of this.store.resources.values()) {
      await this.processResourceDependencies(resource);
    }
  }

  private async computeTaskDependencies(
    task: TaskStoreElementType<any, any, any>
  ) {
    const deps = task.task.dependencies as DependencyMapType;
    task.computedDependencies = await this.extractDependencies(deps);

    let eventDefinition = task.task.on;
    if (eventDefinition) {
      if (this.store.events.get(eventDefinition.id) === undefined) {
        throw Errors.eventNotFound(eventDefinition.id);
      }

      this.eventManager.addListener(
        eventDefinition,
        async (receivedEvent) => {
          return this.taskRunner.run(
            task.task,
            receivedEvent,
            task.computedDependencies
          );
        },
        {
          order: task.task.priority || 0,
        }
      );
    }
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
        resource.value = await this.resourceInitializer.initializeResource(
          resource.resource,
          resource.config,
          resource.computedDependencies as DependencyValuesType<{}>
        );
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
    resource.computedDependencies = await this.extractDependencies(deps);
  }

  public async initializeRoot() {
    const storeResource = this.store.root;

    storeResource.value = await this.resourceInitializer.initializeResource(
      storeResource.resource,
      storeResource.config,
      // They are already computed
      storeResource.computedDependencies as DependencyValuesType<{}>
    );

    storeResource.isInitialized = true;
  }

  /**
   * Processes all hooks, should run before emission of any event.
   * @returns
   */
  public attachHooks() {
    // iterate through resources and send them to processHooks
    for (const resource of this.store.resources.values()) {
      if (resource.resource.hooks) {
        this.attachHooksToResource(resource);
      }
    }
  }

  /**
   * Processes the hooks for resources
   * @param hooks
   * @param deps
   */
  public attachHooksToResource(
    resourceStoreElement: ResourceStoreElementType<any, any, {}>
  ) {
    let hooks = resourceStoreElement.resource.hooks;
    if (typeof hooks === "function") {
      hooks = hooks(resourceStoreElement.config);
    }

    if (hooks.length === 0) {
      return;
    }

    for (const hook of hooks) {
      const event = hook.event;
      const order = hook.priority || 0;
      if (event === "*") {
        this.eventManager.addGlobalListener(
          async (receivedEvent) => {
            return hook.run(
              receivedEvent,
              resourceStoreElement.computedDependencies as DependencyValuesType<{}>
            );
          },
          {
            order,
          }
        );
      } else {
        if (this.store.events.has(event.id) === false) {
          throw Errors.eventNotFound(event.id);
        }
        this.eventManager.addListener(
          event,
          async (receivedEvent) => {
            return hook.run(
              receivedEvent,
              resourceStoreElement.computedDependencies as DependencyValuesType<{}>
            );
          },
          {
            order,
          }
        );
      }
    }
  }

  async extractDependencies<T extends DependencyMapType>(
    map: T
  ): Promise<DependencyValuesType<T>> {
    const object = {} as DependencyValuesType<T>;

    for (const key in map) {
      object[key] = await this.extractDependency(map[key]);
    }

    return object;
  }

  async extractDependency(object) {
    if (utils.isResource(object)) {
      return this.extractResourceDependency(object);
    } else if (utils.isTask(object)) {
      return this.extractTaskDependency(object);
    } else if (utils.isEvent(object)) {
      return this.extractEventDependency(object);
    } else {
      throw Errors.unknownItemType(object);
    }
  }

  /**
   * Converts the event into a running functions with real inputs
   * @param object
   * @returns
   */
  extractEventDependency(object: IEventDefinition<Record<string, any>>) {
    return async (input) => {
      return this.eventManager.emit(object, input);
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
        dependencies
      );
    }

    return (input) => {
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
        storeResource.value = await this.resourceInitializer.initializeResource(
          resource,
          config,
          await this.extractDependencies(resource.dependencies || {})
        );
      }
    }

    return storeResource.value;
  }
}
