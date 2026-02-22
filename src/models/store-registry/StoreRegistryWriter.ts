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
  EventStoreElementType,
  HookStoreElementType,
  ResourceMiddlewareStoreElementType,
  ResourceStoreElementType,
  TaskMiddlewareStoreElementType,
  TaskStoreElementType,
  symbolEvent,
  symbolHook,
  symbolResource,
  symbolResourceMiddleware,
  symbolResourceWithConfig,
  symbolTag,
  symbolTask,
  symbolTaskMiddleware,
} from "../../defs";
import { unknownItemTypeError } from "../../errors";
import { IAsyncContext } from "../../types/asyncContext";
import { IErrorHelper } from "../../types/error";
import { HookDependencyState } from "../../types/storeTypes";
import { symbolAsyncContext, symbolError } from "../../types/symbols";
import { VisibilityTracker } from "../VisibilityTracker";
import { StoreRegistryDefinitionPreparer } from "./StoreRegistryDefinitionPreparer";
import { StoreRegistryTagIndex } from "./StoreRegistryTagIndex";
import { IndexedTagCategory, normalizeTags, StoringMode } from "./types";

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
  trackRegisteredId: (id: string) => void;
};

enum RegisterableKind {
  Task = "task",
  Error = "error",
  Hook = "hook",
  Resource = "resource",
  Event = "event",
  AsyncContext = "asyncContext",
  TaskMiddleware = "taskMiddleware",
  ResourceMiddleware = "resourceMiddleware",
  ResourceWithConfig = "resourceWithConfig",
  Tag = "tag",
}

function hasSymbolBrand(
  item: RegisterableItems,
  symbolKey: symbol,
): item is RegisterableItems {
  if (item === null || item === undefined) {
    return false;
  }

  const type = typeof item;
  if (type !== "object" && type !== "function") {
    return false;
  }

  return Boolean((item as unknown as Record<symbol, unknown>)[symbolKey]);
}

function resolveRegisterableKind(
  item: RegisterableItems,
): RegisterableKind | null {
  if (hasSymbolBrand(item, symbolTask)) {
    return RegisterableKind.Task;
  }
  if (hasSymbolBrand(item, symbolError)) {
    return RegisterableKind.Error;
  }
  if (hasSymbolBrand(item, symbolHook)) {
    return RegisterableKind.Hook;
  }
  if (hasSymbolBrand(item, symbolResource)) {
    return RegisterableKind.Resource;
  }
  if (hasSymbolBrand(item, symbolEvent)) {
    return RegisterableKind.Event;
  }
  if (hasSymbolBrand(item, symbolAsyncContext)) {
    return RegisterableKind.AsyncContext;
  }
  if (hasSymbolBrand(item, symbolTaskMiddleware)) {
    return RegisterableKind.TaskMiddleware;
  }
  if (hasSymbolBrand(item, symbolResourceMiddleware)) {
    return RegisterableKind.ResourceMiddleware;
  }
  if (hasSymbolBrand(item, symbolResourceWithConfig)) {
    return RegisterableKind.ResourceWithConfig;
  }
  if (hasSymbolBrand(item, symbolTag)) {
    return RegisterableKind.Tag;
  }
  return null;
}

export class StoreRegistryWriter {
  constructor(
    private readonly collections: StoreRegistryCollections,
    private readonly validator: StoreRegistryValidation,
    private readonly visibilityTracker: VisibilityTracker,
    private readonly tagIndex: StoreRegistryTagIndex,
    private readonly definitionPreparer: StoreRegistryDefinitionPreparer,
  ) {}

  storeGenericItem<_C>(item: RegisterableItems) {
    const kind = resolveRegisterableKind(item);

    switch (kind) {
      case RegisterableKind.Task:
        this.storeTask<_C>(item as ITask<any, any, {}>);
        return;
      case RegisterableKind.Error:
        this.storeError<_C>(item as IErrorHelper<any>);
        return;
      case RegisterableKind.Hook:
        this.storeHook<_C>(item as IHook);
        return;
      case RegisterableKind.Resource:
        this.storeResource<_C>(item as IResource<any, any, any>);
        return;
      case RegisterableKind.Event:
        this.storeEvent<_C>(item as IEvent<void>);
        return;
      case RegisterableKind.AsyncContext:
        this.storeAsyncContext<_C>(item as IAsyncContext<any>);
        return;
      case RegisterableKind.TaskMiddleware:
        this.storeTaskMiddleware<_C>(item as ITaskMiddleware<any>);
        return;
      case RegisterableKind.ResourceMiddleware:
        this.storeResourceMiddleware<_C>(item as IResourceMiddleware<any>);
        return;
      case RegisterableKind.ResourceWithConfig:
        this.storeResourceWithConfig<_C>(
          item as IResourceWithConfig<any, any, any>,
        );
        return;
      case RegisterableKind.Tag:
        this.storeTag(item as ITag<any, any, any>);
        return;
      default:
        unknownItemTypeError.throw({ item });
    }
  }

  storeError<_C>(item: IErrorHelper<any>) {
    this.validator.checkIfIDExists(item.id);
    this.collections.errors.set(item.id, item);
    this.validator.trackRegisteredId(item.id);
    const tags = normalizeTags(item.tags);
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.Errors,
      item.id,
      tags,
    );
    this.visibilityTracker.recordDefinitionTags(item.id, tags);
  }

  storeAsyncContext<_C>(item: IAsyncContext<any>) {
    this.validator.checkIfIDExists(item.id);
    this.collections.asyncContexts.set(item.id, item);
    this.validator.trackRegisteredId(item.id);
  }

  storeTag(item: ITag<any, any, any>) {
    this.validator.checkIfIDExists(item.id);
    this.collections.tags.set(item.id, item);
    this.validator.trackRegisteredId(item.id);
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
    this.validator.trackRegisteredId(hook.id);
    const tags = normalizeTags(hook.tags);
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.Hooks,
      hook.id,
      tags,
    );
    this.visibilityTracker.recordDefinitionTags(hook.id, tags);
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
    this.validator.trackRegisteredId(middleware.id);
    const tags = normalizeTags(middleware.tags);
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.TaskMiddlewares,
      middleware.id,
      tags,
    );
    this.visibilityTracker.recordDefinitionTags(middleware.id, tags);
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
    this.validator.trackRegisteredId(middleware.id);
    const tags = normalizeTags(middleware.tags);
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.ResourceMiddlewares,
      middleware.id,
      tags,
    );
    this.visibilityTracker.recordDefinitionTags(middleware.id, tags);
  }

  storeEvent<_C>(item: IEvent<void>) {
    this.validator.checkIfIDExists(item.id);
    this.collections.events.set(item.id, { event: item });
    this.validator.trackRegisteredId(item.id);
    const tags = normalizeTags(item.tags);
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.Events,
      item.id,
      tags,
    );
    this.visibilityTracker.recordDefinitionTags(item.id, tags);
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
    this.validator.trackRegisteredId(prepared.id);
    this.visibilityTracker.recordResource(prepared.id);
    this.visibilityTracker.recordWiringAccessPolicy(
      prepared.id,
      prepared.wiringAccessPolicy,
    );
    const tags = normalizeTags(prepared.tags);
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.Resources,
      prepared.id,
      tags,
    );
    this.visibilityTracker.recordDefinitionTags(prepared.id, tags);

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
    this.validator.trackRegisteredId(prepared.id);
    this.visibilityTracker.recordResource(prepared.id);
    this.visibilityTracker.recordWiringAccessPolicy(
      prepared.id,
      prepared.wiringAccessPolicy,
    );
    const tags = normalizeTags(prepared.tags);
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.Resources,
      prepared.id,
      tags,
    );
    this.visibilityTracker.recordDefinitionTags(prepared.id, tags);

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
    this.validator.trackRegisteredId(task.id);
    const tags = normalizeTags(task.tags);
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.Tasks,
      task.id,
      tags,
    );
    this.visibilityTracker.recordDefinitionTags(task.id, tags);
  }
}
