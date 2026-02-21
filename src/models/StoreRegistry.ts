import {
  AnyResource,
  AnyTask,
  IEvent,
  IHook,
  IResource,
  IResourceMiddleware,
  IResourceWithConfig,
  ITag,
  ITask,
  ITaskMiddleware,
  RegisterableItems,
  TagDependencyAccessor,
  TaggedResource,
  TaggedTask,
  TaskMiddlewareStoreElementType,
  TaskStoreElementType,
  ResourceMiddlewareStoreElementType,
  ResourceStoreElementType,
  EventStoreElementType,
  HookStoreElementType,
} from "../defs";
import { StoreValidator } from "./StoreValidator";
import { Store } from "./Store";
import {
  buildDependencyGraph,
  buildEventEmissionGraph as buildEmissionGraph,
} from "./utils/buildDependencyGraph";
import { IErrorHelper } from "../types/error";
import type { IAsyncContext } from "../types/asyncContext";
import { LockableMap } from "../tools/LockableMap";
import { VisibilityTracker } from "./VisibilityTracker";
import { StoreRegistryDefinitionPreparer } from "./store-registry/StoreRegistryDefinitionPreparer";
import { StoreRegistryTagIndex } from "./store-registry/StoreRegistryTagIndex";
import { StoreRegistryWriter } from "./store-registry/StoreRegistryWriter";
import { StoringMode, TagIndexBucket } from "./store-registry/types";

export class StoreRegistry {
  public tasks = new LockableMap<string, TaskStoreElementType>("tasks");
  public resources = new LockableMap<string, ResourceStoreElementType>(
    "resources",
  );
  public events = new LockableMap<string, EventStoreElementType>("events");
  public taskMiddlewares = new LockableMap<
    string,
    TaskMiddlewareStoreElementType
  >("taskMiddlewares");
  public resourceMiddlewares = new LockableMap<
    string,
    ResourceMiddlewareStoreElementType
  >("resourceMiddlewares");
  public hooks = new LockableMap<string, HookStoreElementType>("hooks");
  public tags = new LockableMap<string, ITag>("tags");
  public asyncContexts = new LockableMap<string, IAsyncContext<any>>(
    "asyncContexts",
  );
  public errors = new LockableMap<string, IErrorHelper<any>>("errors");
  public readonly visibilityTracker = new VisibilityTracker();

  // Kept on the registry for backward compatibility in tests/tools.
  public readonly tagIndex: Map<string, TagIndexBucket>;

  private readonly validator: StoreValidator;
  private readonly tagIndexer: StoreRegistryTagIndex;
  private readonly writer: StoreRegistryWriter;

  constructor(protected readonly store: Store) {
    this.validator = new StoreValidator(this);

    this.tagIndexer = new StoreRegistryTagIndex(
      {
        tasks: this.tasks,
        resources: this.resources,
        events: this.events,
        hooks: this.hooks,
        taskMiddlewares: this.taskMiddlewares,
        resourceMiddlewares: this.resourceMiddlewares,
        errors: this.errors,
        tags: this.tags,
      },
      this.visibilityTracker,
    );
    this.tagIndex = this.tagIndexer.index;

    this.writer = new StoreRegistryWriter(
      {
        tasks: this.tasks,
        resources: this.resources,
        events: this.events,
        taskMiddlewares: this.taskMiddlewares,
        resourceMiddlewares: this.resourceMiddlewares,
        hooks: this.hooks,
        tags: this.tags,
        asyncContexts: this.asyncContexts,
        errors: this.errors,
      },
      this.validator,
      this.visibilityTracker,
      this.tagIndexer,
      new StoreRegistryDefinitionPreparer(),
    );
  }

  getValidator(): StoreValidator {
    return this.validator;
  }

  /** Lock every map in the registry, preventing further mutations. */
  lockAll(): void {
    this.tasks.lock();
    this.resources.lock();
    this.events.lock();
    this.taskMiddlewares.lock();
    this.resourceMiddlewares.lock();
    this.hooks.lock();
    this.tags.lock();
    this.asyncContexts.lock();
    this.errors.lock();
  }

  storeGenericItem<_C>(item: RegisterableItems) {
    return this.writer.storeGenericItem<_C>(item);
  }

  storeError<_C>(item: IErrorHelper<any>) {
    return this.writer.storeError<_C>(item);
  }

  storeAsyncContext<_C>(item: IAsyncContext<any>) {
    return this.writer.storeAsyncContext<_C>(item);
  }

  storeTag(item: ITag<any, any, any>) {
    return this.writer.storeTag(item);
  }

  storeHook<_C>(item: IHook<any, any>, overrideMode: StoringMode = "normal") {
    return this.writer.storeHook<_C>(item, overrideMode);
  }

  storeTaskMiddleware<_C>(
    item: ITaskMiddleware<any>,
    storingMode: StoringMode = "normal",
  ) {
    return this.writer.storeTaskMiddleware<_C>(item, storingMode);
  }

  storeResourceMiddleware<_C>(
    item: IResourceMiddleware<any>,
    overrideMode: StoringMode = "normal",
  ) {
    return this.writer.storeResourceMiddleware<_C>(item, overrideMode);
  }

  storeEvent<_C>(item: IEvent<void>) {
    return this.writer.storeEvent<_C>(item);
  }

  storeResourceWithConfig<_C>(
    item: IResourceWithConfig<any, any, any>,
    storingMode: StoringMode = "normal",
  ) {
    return this.writer.storeResourceWithConfig<_C>(item, storingMode);
  }

  computeRegistrationDeeply<_C>(element: IResource<_C>, config?: _C) {
    return this.writer.computeRegistrationDeeply(element, config);
  }

  storeResource<_C>(
    item: IResource<any, any, any>,
    overrideMode: StoringMode = "normal",
  ) {
    return this.writer.storeResource<_C>(item, overrideMode);
  }

  storeTask<_C>(
    item: ITask<any, any, {}>,
    storingMode: StoringMode = "normal",
  ) {
    return this.writer.storeTask<_C>(item, storingMode);
  }

  getDependentNodes() {
    return buildDependencyGraph(this);
  }

  /**
   * Builds a directed graph of event emissions based on hooks listening to events
   * and their dependencies on events (emission capability). Ignores wildcard hooks by default.
   */
  buildEventEmissionGraph() {
    return buildEmissionGraph(this);
  }

  getTagAccessor<TTag extends ITag<any, any, any>>(
    tag: TTag,
    options?: { consumerId?: string; includeSelf?: boolean },
  ): TagDependencyAccessor<TTag> {
    return this.tagIndexer.getTagAccessor(tag, options);
  }

  /**
   * @deprecated Use tag dependencies (`dependencies({ myTag })`) and the injected accessor.
   */
  getTasksWithTag<TTag extends ITag<any, any, any>>(
    tag: TTag,
  ): TaggedTask<TTag>[];
  /**
   * @deprecated Use tag dependencies (`dependencies({ myTag })`) and the injected accessor.
   */
  getTasksWithTag(tag: string): AnyTask[];
  /**
   * @deprecated Use tag dependencies (`dependencies({ myTag })`) and the injected accessor.
   */
  getTasksWithTag(tag: string | ITag<any, any, any>): AnyTask[] {
    return typeof tag === "string"
      ? this.tagIndexer.getTasksWithTag(tag)
      : this.tagIndexer.getTasksWithTag(tag);
  }

  /**
   * @deprecated Use tag dependencies (`dependencies({ myTag })`) and the injected accessor.
   */
  getResourcesWithTag<TTag extends ITag<any, any, any>>(
    tag: TTag,
  ): TaggedResource<TTag>[];
  /**
   * @deprecated Use tag dependencies (`dependencies({ myTag })`) and the injected accessor.
   */
  getResourcesWithTag(tag: string): AnyResource[];
  /**
   * @deprecated Use tag dependencies (`dependencies({ myTag })`) and the injected accessor.
   */
  getResourcesWithTag(tag: string | ITag<any, any, any>): AnyResource[] {
    return typeof tag === "string"
      ? this.tagIndexer.getResourcesWithTag(tag)
      : this.tagIndexer.getResourcesWithTag(tag);
  }
}
