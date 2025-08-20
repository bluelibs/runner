import {
  DependencyMapType,
  DependencyValuesType,
  ITask,
  IResource,
  IEventDefinition,
  IEvent,
  IEventEmission,
  TaskLocalInterceptor,
  ResourceDependencyValuesType,
  TaskDependencyWithIntercept,
  IResourceMiddleware,
  ITaskMiddleware,
} from "../defs";
import { Store } from "./Store";
import { symbolHook } from "../defs";
import {
  ResourceStoreElementType,
  TaskStoreElementType,
  TaskMiddlewareStoreElementType,
  ResourceMiddlewareStoreElementType,
} from "../types/storeTypes";
import * as utils from "../define";
import { EventManager } from "./EventManager";
import { ResourceInitializer } from "./ResourceInitializer";
import { TaskRunner } from "./TaskRunner";
import {
  DependencyNotFoundError,
  EventNotFoundError,
  MiddlewareNotRegisteredError,
  UnknownItemTypeError,
} from "../errors";
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
    protected readonly logger: Logger,
  ) {
    this.resourceInitializer = new ResourceInitializer(
      store,
      eventManager,
      logger,
    );
  }

  /**
   * This function is going to go through all the resources, tasks and middleware to compute their required dependencies.
   */
  async computeAllDependencies() {
    for (const middleware of this.store.resourceMiddlewares.values()) {
      const computedDependencies = await this.extractDependencies(
        middleware.middleware.dependencies,
        middleware.middleware.id,
      );

      middleware.computedDependencies = computedDependencies;
      middleware.isInitialized = true;
    }

    for (const middleware of this.store.taskMiddlewares.values()) {
      const computedDependencies = await this.extractDependencies(
        middleware.middleware.dependencies,
        middleware.middleware.id,
      );

      middleware.computedDependencies = computedDependencies;
      middleware.isInitialized = true;
    }

    for (const resource of this.store.resources.values()) {
      await this.processResourceDependencies(resource);
    }

    for (const task of this.store.tasks.values()) {
      await this.computeTaskDependencies(task);
    }

    // Compute hook dependencies (hooks cannot be dependencies themselves)
    for (const hookStoreElement of this.store.hooks.values()) {
      const hook = hookStoreElement.hook;
      const deps = hook.dependencies as DependencyMapType;
      hookStoreElement.computedDependencies = await this.extractDependencies(
        deps,
        hook.id,
      );
    }

    // leftovers that were registered but not depended upon, except root
    // they should still be initialized as they might extend other
    await this.initializeUninitializedResources();
  }

  private async computeTaskDependencies(
    task: TaskStoreElementType<any, any, any>,
  ) {
    const deps = task.task.dependencies as DependencyMapType;
    task.computedDependencies = await this.extractDependencies(
      deps,
      task.task.id,
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
            resource.computedDependencies!,
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
  protected async processResourceDependencies<TD extends DependencyMapType>(
    resource: ResourceStoreElementType<any, any, TD>,
  ) {
    const deps = (resource.resource.dependencies || ({} as TD)) as TD;
    const extracted = await this.extractDependencies(
      deps,
      resource.resource.id,
    );

    resource.computedDependencies = this.wrapResourceDependencies<TD>(
      deps,
      extracted,
    );
    // resource.isInitialized = true;
  }

  private wrapResourceDependencies<TD extends DependencyMapType>(
    deps: TD,
    extracted: DependencyValuesType<TD>,
  ): ResourceDependencyValuesType<TD> {
    const wrapped: Record<string, unknown> = {};
    for (const key of Object.keys(deps) as Array<keyof TD>) {
      const original = deps[key] as any;
      const value = (extracted as Record<string, unknown>)[key as string];
      // Handle optional wrappers
      if (utils.isOptional(original)) {
        const inner = original.inner as any;
        if (utils.isTask(inner)) {
          wrapped[key as string] = value
            ? this.makeTaskWithIntercept(inner)
            : undefined;
        } else {
          wrapped[key as string] = value as unknown;
        }
        continue;
      }
      if (utils.isTask(original)) {
        wrapped[key as string] = this.makeTaskWithIntercept(original);
      } else {
        wrapped[key as string] = value as unknown;
      }
    }
    return wrapped as unknown as ResourceDependencyValuesType<TD>;
  }

  private makeTaskWithIntercept<
    I,
    O extends Promise<any>,
    D extends DependencyMapType,
  >(original: ITask<I, O, D>): TaskDependencyWithIntercept<I, O> {
    const taskId = original.id;
    const fn: (input: I) => O = (input) => {
      const storeTask = this.store.tasks.get(taskId)!;
      const effective: ITask<I, O, D> = storeTask.task;

      return this.taskRunner.run(effective, input) as O;
    };
    return Object.assign(fn, {
      intercept: (middleware: TaskLocalInterceptor<I, O>) => {
        this.store.checkLock();
        const storeTask = this.store.tasks.get(taskId)!;

        if (!storeTask.interceptors) storeTask.interceptors = [];
        storeTask.interceptors.push(middleware);
      },
    }) as TaskDependencyWithIntercept<I, O>;
  }

  public async initializeRoot() {
    const rootResource = this.store.root;

    const { value, context } =
      await this.resourceInitializer.initializeResource(
        rootResource.resource,
        rootResource.config,
        // They are already computed
        rootResource.computedDependencies!,
      );

    rootResource.context = context;
    rootResource.value = value;
    rootResource.isInitialized = true;
  }

  /**
   * Processes all hooks, should run before emission of any event.
   */
  public attachListeners() {
    // Attach listeners for dedicated hooks map
    for (const hookStoreElement of this.store.hooks.values()) {
      const hook = hookStoreElement.hook;
      if (hook.on) {
        const eventDefinition = hook.on;

        const handler = async (receivedEvent: IEventEmission<any>) => {
          if (receivedEvent.source === hook.id) {
            return;
          }
          return this.taskRunner.runHook(hook, receivedEvent);
        };

        const order = hook.order ?? 0;

        if (eventDefinition === "*") {
          this.eventManager.addGlobalListener(handler, { order });
        } else {
          if (this.store.events.get(eventDefinition.id) === undefined) {
            throw new EventNotFoundError(eventDefinition.id);
          }
          this.eventManager.addListener(eventDefinition, handler, { order });
        }
      }
    }
  }

  async extractDependencies<T extends DependencyMapType>(
    map: T,
    source: string,
  ): Promise<DependencyValuesType<T>> {
    const object = {} as DependencyValuesType<T>;

    for (const key in map) {
      try {
        object[key] = await this.extractDependency(map[key], source);
      } catch (e) {
        const errorMessage = String(e);
        this.logger.error(
          `Failed to extract dependency from source: ${source} -> ${key} with error: ${errorMessage}`,
        );

        throw e;
      }
    }

    return object;
  }

  async extractDependency(object: any, source: string) {
    if (utils.isOptional(object)) {
      const inner = object.inner;
      if (utils.isResource(inner)) {
        const exists = this.store.resources.get(inner.id) !== undefined;
        return exists ? this.extractResourceDependency(inner) : undefined;
      } else if (utils.isTask(inner)) {
        const exists = this.store.tasks.get(inner.id) !== undefined;
        return exists ? this.extractTaskDependency(inner) : undefined;
      } else if (utils.isEvent(inner)) {
        const exists = this.store.events.get(inner.id) !== undefined;
        return exists ? this.extractEventDependency(inner, source) : undefined;
      }
      throw new UnknownItemTypeError(inner);
    }
    if (utils.isResource(object)) {
      return this.extractResourceDependency(object);
    } else if (utils.isTask(object)) {
      return this.extractTaskDependency(object);
    } else if (utils.isEvent(object)) {
      return this.extractEventDependency(object, source);
    } else {
      throw new UnknownItemTypeError(object);
    }
  }

  /**
   * Converts the event into a running functions with real inputs
   * @param object
   * @returns
   */
  extractEventDependency(object: IEvent<any>, source: string) {
    return async (input: any) => {
      return this.eventManager.emit(object, input, source);
    };
  }

  async extractTaskDependency(object: ITask<any, any, {}>) {
    const storeTask = this.store.tasks.get(object.id);
    if (storeTask === undefined) {
      throw new DependencyNotFoundError(`Task ${object.id}`);
    }

    if (!storeTask.isInitialized) {
      // it's sanitised
      const dependencies = object.dependencies as DependencyMapType;

      storeTask.computedDependencies = await this.extractDependencies(
        dependencies,
        storeTask.task.id,
      );
      storeTask.isInitialized = true;
    }

    return (input: unknown) => {
      return this.taskRunner.run(storeTask.task, input);
    };
  }

  async extractResourceDependency(object: IResource<any, any, any>) {
    // check if it exists in the store with the value
    const storeResource = this.store.resources.get(object.id);
    if (storeResource === undefined) {
      throw new DependencyNotFoundError(`Resource ${object.id}`);
    }

    const { resource, config } = storeResource;

    if (storeResource.isInitialized) {
      return storeResource.value;
    } else {
      // check if it has an initialisation function that provides the value
      if (resource.init) {
        const depMap = (resource.dependencies || {}) as DependencyMapType;
        const raw = await this.extractDependencies(depMap, resource.id);
        const wrapped = this.wrapResourceDependencies(depMap, raw);
        const { value, context } =
          await this.resourceInitializer.initializeResource(
            resource,
            config,
            wrapped,
          );

        storeResource.context = context;
        storeResource.value = value;
      }

      // we need to initialize the resource
      storeResource.isInitialized = true;
    }

    return storeResource.value;
  }
}
