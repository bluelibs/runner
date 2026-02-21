import {
  IResource,
  ITask,
  AnyTask,
  IResourceWithConfig,
  RegisterableItems,
  ITaskMiddleware,
  IResourceMiddleware,
  IEvent,
  ITag,
  IHook,
  TaggedTask,
  TaggedResource,
  TagDependencyAccessor,
  TagDependencyMatch,
  AnyResource,
} from "../defs";
import * as utils from "../define";
import { unknownItemTypeError } from "../errors";
import {
  TaskStoreElementType,
  TaskMiddlewareStoreElementType,
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
import { HookDependencyState } from "../types/storeTypes";
import { LockableMap } from "../tools/LockableMap";
import { VisibilityTracker } from "./VisibilityTracker";

type StoringMode = "normal" | "override";
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

  private validator: StoreValidator;

  constructor(protected readonly store: Store) {
    this.validator = new StoreValidator(this);
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
    if (utils.isTask(item)) {
      this.storeTask<_C>(item);
    } else if (utils.isError(item)) {
      this.storeError<_C>(item as IErrorHelper<any>);
    } else if (utils.isHook && utils.isHook(item)) {
      this.storeHook<_C>(item as IHook);
    } else if (utils.isResource(item)) {
      this.storeResource<_C>(item);
    } else if (utils.isEvent(item)) {
      this.storeEvent<_C>(item);
    } else if (utils.isAsyncContext(item)) {
      this.storeAsyncContext<_C>(item as IAsyncContext<any>);
    } else if (utils.isTaskMiddleware(item)) {
      this.storeTaskMiddleware<_C>(item as ITaskMiddleware<any>);
    } else if (utils.isResourceMiddleware(item)) {
      this.storeResourceMiddleware<_C>(item as IResourceMiddleware<any>);
    } else if (utils.isResourceWithConfig(item)) {
      this.storeResourceWithConfig<_C>(item);
    } else if (utils.isTag(item)) {
      this.storeTag(item);
    } else {
      unknownItemTypeError.throw({ item });
    }
  }

  storeError<_C>(item: IErrorHelper<any>) {
    this.validator.checkIfIDExists(item.id);
    this.errors.set(item.id, item);
  }

  storeAsyncContext<_C>(item: IAsyncContext<any>) {
    this.validator.checkIfIDExists(item.id);
    this.asyncContexts.set(item.id, item);
  }

  storeTag(item: ITag<any, any, any>) {
    this.validator.checkIfIDExists(item.id);
    this.tags.set(item.id, item);
  }

  storeHook<_C>(item: IHook<any, any>, overrideMode: StoringMode = "normal") {
    overrideMode === "normal" && this.validator.checkIfIDExists(item.id);

    const hook = this.getFreshValue(item, this.hooks, "hook", overrideMode);

    // store separately
    this.hooks.set(hook.id, {
      hook,
      computedDependencies: {},
      dependencyState: HookDependencyState.Pending,
    });
  }

  storeTaskMiddleware<_C>(
    item: ITaskMiddleware<any>,
    storingMode: StoringMode = "normal",
  ) {
    storingMode === "normal" && this.validator.checkIfIDExists(item.id);

    const middleware = this.getFreshValue(
      item,
      this.taskMiddlewares,
      "middleware",
      storingMode,
    );

    this.taskMiddlewares.set(item.id, {
      middleware,
      computedDependencies: {},
      isInitialized: false,
    });
  }

  storeResourceMiddleware<_C>(
    item: IResourceMiddleware<any>,
    overrideMode: StoringMode = "normal",
  ) {
    overrideMode === "normal" && this.validator.checkIfIDExists(item.id);
    const middleware = this.getFreshValue(
      item,
      this.resourceMiddlewares,
      "middleware",
      overrideMode,
    );

    this.resourceMiddlewares.set(item.id, {
      middleware,
      computedDependencies: {},
      isInitialized: false,
    });
  }

  storeEvent<_C>(item: IEvent<void>) {
    this.validator.checkIfIDExists(item.id);
    this.events.set(item.id, { event: item });
  }

  storeResourceWithConfig<_C>(
    item: IResourceWithConfig<any, any, any>,
    storingMode: StoringMode = "normal",
  ) {
    storingMode === "normal" &&
      this.validator.checkIfIDExists(item.resource.id);

    const prepared = this.getFreshValue(
      item.resource,
      this.resources,
      "resource",
      storingMode,
      item.config,
    );

    this.resources.set(prepared.id, {
      resource: prepared,
      config: item.config,
      value: undefined,
      isInitialized: false,
      context: undefined,
    });

    this.computeRegistrationDeeply(prepared, item.config);
    return prepared;
  }

  computeRegistrationDeeply<_C>(element: IResource<_C>, config?: _C) {
    let items =
      typeof element.register === "function"
        ? element.register(config as _C)
        : element.register;

    if (!items) {
      items = [];
    }

    element.register = items;

    for (const item of items) {
      // Track which resource owns each registered item
      this.visibilityTracker.recordOwnership(element.id, item);
      // will call registration if it detects another resource.
      this.storeGenericItem<_C>(item);
    }

    // Record exports after all items are registered so ids are available
    if (element.exports) {
      this.visibilityTracker.recordExports(element.id, element.exports);
    }
  }

  storeResource<_C>(
    item: IResource<any, any, any>,
    overrideMode: StoringMode = "normal",
  ) {
    overrideMode === "normal" && this.validator.checkIfIDExists(item.id);

    const prepared = this.getFreshValue(
      item,
      this.resources,
      "resource",
      overrideMode,
    );

    this.resources.set(prepared.id, {
      resource: prepared,
      config: {},
      value: undefined,
      isInitialized: false,
      context: undefined,
    });

    this.computeRegistrationDeeply(prepared, {});
    return prepared;
  }

  storeTask<_C>(
    item: ITask<any, any, {}>,
    storingMode: StoringMode = "normal",
  ) {
    storingMode === "normal" && this.validator.checkIfIDExists(item.id);

    const task = this.getFreshValue(item, this.tasks, "task", storingMode);

    this.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: false,
    });
  }

  // Feels like a dependencyProcessor task?
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
    const consumerId = options?.consumerId;
    const includeSelf = options?.includeSelf ?? true;
    const isIncluded = (definitionId: string): boolean => {
      if (!includeSelf && consumerId && definitionId === consumerId) {
        return false;
      }
      if (!consumerId) {
        return true;
      }
      return this.visibilityTracker.isAccessible(definitionId, consumerId);
    };

    const mapToMatch = <TDefinition>(
      list: ReadonlyArray<{
        definition: TDefinition;
        tags: ReadonlyArray<{ id: string; config?: unknown }>;
      }>,
    ): ReadonlyArray<TagDependencyMatch<TDefinition, TTag>> => {
      return list
        .filter((item) => {
          const definitionWithId = item.definition as { id: string };
          return (
            item.tags.some((candidate) => candidate.id === tag.id) &&
            isIncluded(definitionWithId.id)
          );
        })
        .map((item) => {
          return {
            definition: item.definition,
            config: tag.extract(item.tags as unknown as ITag[]),
          };
        });
    };

    const tasks = mapToMatch(
      Array.from(this.tasks.values()).map((item) => ({
        definition: item.task,
        tags: item.task.tags,
      })),
    ) as TagDependencyAccessor<TTag>["tasks"];

    const resources = mapToMatch(
      Array.from(this.resources.values()).map((item) => ({
        definition: item.resource,
        tags: item.resource.tags,
      })),
    ) as TagDependencyAccessor<TTag>["resources"];

    const events = mapToMatch(
      Array.from(this.events.values()).map((item) => ({
        definition: item.event,
        tags: item.event.tags,
      })),
    ) as TagDependencyAccessor<TTag>["events"];

    const hooks = mapToMatch(
      Array.from(this.hooks.values()).map((item) => ({
        definition: item.hook,
        tags: item.hook.tags,
      })),
    ) as TagDependencyAccessor<TTag>["hooks"];

    const taskMiddlewares = mapToMatch(
      Array.from(this.taskMiddlewares.values()).map((item) => ({
        definition: item.middleware,
        tags: item.middleware.tags ?? [],
      })),
    ) as TagDependencyAccessor<TTag>["taskMiddlewares"];

    const resourceMiddlewares = mapToMatch(
      Array.from(this.resourceMiddlewares.values()).map((item) => ({
        definition: item.middleware,
        tags: item.middleware.tags ?? [],
      })),
    ) as TagDependencyAccessor<TTag>["resourceMiddlewares"];

    const errors = mapToMatch(
      Array.from(this.errors.values()).map((item) => ({
        definition: item,
        tags: item.tags,
      })),
    ) as TagDependencyAccessor<TTag>["errors"];

    return Object.freeze({
      tasks: Object.freeze(tasks),
      resources: Object.freeze(resources),
      events: Object.freeze(events),
      hooks: Object.freeze(hooks),
      taskMiddlewares: Object.freeze(taskMiddlewares),
      resourceMiddlewares: Object.freeze(resourceMiddlewares),
      errors: Object.freeze(errors),
    });
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
    if (typeof tag === "string") {
      const found = this.tags.get(tag);
      if (!found) {
        return [];
      }
      return this.getTagAccessor(found).tasks.map((item) => item.definition);
    }

    return this.getTagAccessor(tag).tasks.map((item) => item.definition);
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
    if (typeof tag === "string") {
      const found = this.tags.get(tag);
      if (!found) {
        return [];
      }
      return this.getTagAccessor(found).resources.map(
        (item) => item.definition,
      );
    }

    return this.getTagAccessor(tag).resources.map((item) => item.definition);
  }

  /**
   * Used to fetch the value cloned, and if we're dealing with an override, we need to extend the previous value.
   */
  private getFreshValue<
    T extends { id: string; dependencies?: unknown; config?: unknown },
    MapType,
  >(
    item: T,
    collection: Map<string, MapType>,
    key: keyof MapType,
    overrideMode: StoringMode,
    config?: unknown, // If provided config, takes precedence over config in item.
  ): T {
    let currentItem: T;
    if (overrideMode === "override") {
      const existing = collection.get(item.id)![key];
      currentItem = { ...existing, ...item };
    } else {
      currentItem = { ...item };
    }

    if (typeof currentItem.dependencies === "function") {
      const dependencyFactory = currentItem.dependencies as (
        cfg: unknown,
      ) => unknown;
      const effectiveConfig = config ?? currentItem.config;
      currentItem.dependencies = dependencyFactory(
        effectiveConfig,
      ) as T["dependencies"];
    }

    return currentItem;
  }
}
