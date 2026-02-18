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
      // will call registration if it detects another resource.
      this.storeGenericItem<_C>(item);
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

  getTasksWithTag<TTag extends ITag<any, any, any>>(
    tag: TTag,
  ): TaggedTask<TTag>[];
  getTasksWithTag(tag: string): AnyTask[];
  getTasksWithTag(tag: string | ITag<any, any, any>): AnyTask[] {
    const tagId = typeof tag === "string" ? tag : tag.id;

    return Array.from(this.tasks.values())
      .filter((x) => {
        return x.task.tags.some((t) => t.id === tagId);
      })
      .map((x) => x.task);
  }

  getResourcesWithTag<TTag extends ITag<any, any, any>>(
    tag: TTag,
  ): TaggedResource<TTag>[];
  getResourcesWithTag(tag: string): AnyResource[];
  getResourcesWithTag(tag: string | ITag<any, any, any>): AnyResource[] {
    const tagId = typeof tag === "string" ? tag : tag.id;

    return Array.from(this.resources.values())
      .filter((x) => {
        return x.resource.tags.some((t) => t.id === tagId);
      })
      .map((x) => x.resource);
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
