import {
  AnyResource,
  IEvent,
  IHook,
  IResource,
  IResourceMiddleware,
  IResourceWithConfig,
  ITag,
  ITask,
  ITaskMiddleware,
  RegisterableItems,
  TagType,
  EventStoreElementType,
  HookStoreElementType,
  ResourceMiddlewareStoreElementType,
  ResourceStoreElementType,
  TaskMiddlewareStoreElementType,
  TaskStoreElementType,
} from "../../defs";
import * as utils from "../../define";
import { unknownItemTypeError } from "../../errors";
import { IAsyncContext } from "../../types/asyncContext";
import { IErrorHelper } from "../../types/error";
import { HookDependencyState } from "../../types/storeTypes";
import { VisibilityTracker } from "../VisibilityTracker";
import { StoreRegistryDefinitionPreparer } from "./StoreRegistryDefinitionPreparer";
import { StoreRegistryTagIndex } from "./StoreRegistryTagIndex";
import { IndexedTagCategory, StoringMode } from "./types";

type StoreRegistryCollections = {
  tasks: Map<string, TaskStoreElementType>;
  resources: Map<string, ResourceStoreElementType>;
  events: Map<string, EventStoreElementType>;
  taskMiddlewares: Map<string, TaskMiddlewareStoreElementType>;
  resourceMiddlewares: Map<string, ResourceMiddlewareStoreElementType>;
  hooks: Map<string, HookStoreElementType>;
  tags: Map<string, ITag<any, any, any>>;
  asyncContexts: Map<string, IAsyncContext<any>>;
  errors: Map<string, IErrorHelper<any>>;
};

type StoreRegistryValidation = {
  checkIfIDExists: (id: string) => void;
};

export class StoreRegistryWriter {
  constructor(
    private readonly collections: StoreRegistryCollections,
    private readonly validator: StoreRegistryValidation,
    private readonly visibilityTracker: VisibilityTracker,
    private readonly tagIndex: StoreRegistryTagIndex,
    private readonly definitionPreparer: StoreRegistryDefinitionPreparer,
  ) {}

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
    this.collections.errors.set(item.id, item);
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.Errors,
      item.id,
      this.normalizeTags(item.tags),
    );
  }

  storeAsyncContext<_C>(item: IAsyncContext<any>) {
    this.validator.checkIfIDExists(item.id);
    this.collections.asyncContexts.set(item.id, item);
  }

  storeTag(item: ITag<any, any, any>) {
    this.validator.checkIfIDExists(item.id);
    this.collections.tags.set(item.id, item);
  }

  storeHook<_C>(item: IHook<any, any>, overrideMode: StoringMode = "normal") {
    overrideMode === "normal" && this.validator.checkIfIDExists(item.id);

    const hook = this.definitionPreparer.prepareFreshValue({
      item,
      collection: this.collections.hooks,
      key: "hook",
      mode: overrideMode,
    });

    this.collections.hooks.set(hook.id, {
      hook,
      computedDependencies: {},
      dependencyState: HookDependencyState.Pending,
    });
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.Hooks,
      hook.id,
      this.normalizeTags(hook.tags),
    );
  }

  storeTaskMiddleware<_C>(
    item: ITaskMiddleware<any>,
    storingMode: StoringMode = "normal",
  ) {
    storingMode === "normal" && this.validator.checkIfIDExists(item.id);

    const middleware = this.definitionPreparer.prepareFreshValue({
      item,
      collection: this.collections.taskMiddlewares,
      key: "middleware",
      mode: storingMode,
    });

    this.collections.taskMiddlewares.set(item.id, {
      middleware,
      computedDependencies: {},
      isInitialized: false,
    });
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.TaskMiddlewares,
      middleware.id,
      this.normalizeTags(middleware.tags),
    );
  }

  storeResourceMiddleware<_C>(
    item: IResourceMiddleware<any>,
    overrideMode: StoringMode = "normal",
  ) {
    overrideMode === "normal" && this.validator.checkIfIDExists(item.id);
    const middleware = this.definitionPreparer.prepareFreshValue({
      item,
      collection: this.collections.resourceMiddlewares,
      key: "middleware",
      mode: overrideMode,
    });

    this.collections.resourceMiddlewares.set(item.id, {
      middleware,
      computedDependencies: {},
      isInitialized: false,
    });
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.ResourceMiddlewares,
      middleware.id,
      this.normalizeTags(middleware.tags),
    );
  }

  storeEvent<_C>(item: IEvent<void>) {
    this.validator.checkIfIDExists(item.id);
    this.collections.events.set(item.id, { event: item });
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.Events,
      item.id,
      this.normalizeTags(item.tags),
    );
  }

  storeResourceWithConfig<_C>(
    item: IResourceWithConfig<any, any, any>,
    storingMode: StoringMode = "normal",
  ) {
    storingMode === "normal" &&
      this.validator.checkIfIDExists(item.resource.id);

    const prepared = this.definitionPreparer.prepareFreshValue({
      item: item.resource,
      collection: this.collections.resources,
      key: "resource",
      mode: storingMode,
      config: item.config,
    });

    this.collections.resources.set(prepared.id, {
      resource: prepared,
      config: item.config,
      value: undefined,
      isInitialized: false,
      context: undefined,
    });
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.Resources,
      prepared.id,
      this.normalizeTags(prepared.tags),
    );

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
      this.visibilityTracker.recordOwnership(element.id, item);
      this.storeGenericItem<_C>(item);
    }

    if (element.exports) {
      this.visibilityTracker.recordExports(element.id, element.exports);
    }
  }

  storeResource<_C>(
    item: IResource<any, any, any>,
    overrideMode: StoringMode = "normal",
  ) {
    overrideMode === "normal" && this.validator.checkIfIDExists(item.id);

    const prepared = this.definitionPreparer.prepareFreshValue({
      item,
      collection: this.collections.resources,
      key: "resource",
      mode: overrideMode,
    });

    this.collections.resources.set(prepared.id, {
      resource: prepared,
      config: {},
      value: undefined,
      isInitialized: false,
      context: undefined,
    });
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.Resources,
      prepared.id,
      this.normalizeTags(prepared.tags),
    );

    this.computeRegistrationDeeply(prepared, {});
    return prepared as AnyResource;
  }

  storeTask<_C>(
    item: ITask<any, any, {}>,
    storingMode: StoringMode = "normal",
  ) {
    storingMode === "normal" && this.validator.checkIfIDExists(item.id);

    const task = this.definitionPreparer.prepareFreshValue({
      item,
      collection: this.collections.tasks,
      key: "task",
      mode: storingMode,
    });

    this.collections.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: false,
    });
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.Tasks,
      task.id,
      this.normalizeTags(task.tags),
    );
  }

  private normalizeTags(tags: unknown): TagType[] {
    if (!Array.isArray(tags) || tags.length === 0) {
      return [];
    }

    const normalized: TagType[] = [];
    for (const candidate of tags) {
      if (utils.isTag(candidate)) {
        normalized.push(candidate);
      }
    }

    return normalized;
  }
}
