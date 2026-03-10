import {
  AnyResource,
  IEvent,
  IHook,
  IResource,
  IResourceMiddleware,
  IResourceWithConfig,
  ITag,
  TagType,
  ITask,
  ITaskMiddleware,
  RegisterableItems,
  EventStoreElementType,
  HookStoreElementType,
  ResourceMiddlewareStoreElementType,
  ResourceStoreElementType,
  TaskMiddlewareStoreElementType,
  TaskStoreElementType,
  SubtreeResourceMiddlewareEntry,
  SubtreeTaskMiddlewareEntry,
  symbolEvent,
  symbolHook,
  symbolResource,
  symbolResourceIsolateDeclarations,
  symbolResourceSubtreeDeclarations,
  symbolResourceMiddleware,
  symbolResourceWithConfig,
  symbolTag,
  symbolTask,
  symbolTaskMiddleware,
} from "../../defs";
import { unknownItemTypeError, validationError } from "../../errors";
import { IAsyncContext } from "../../types/asyncContext";
import { IErrorHelper } from "../../types/error";
import { HookDependencyState } from "../../types/storeTypes";
import { symbolAsyncContext, symbolError } from "../../types/symbols";
import { VisibilityTracker } from "../VisibilityTracker";
import { StoreRegistryDefinitionPreparer } from "./StoreRegistryDefinitionPreparer";
import { StoreRegistryTagIndex } from "./StoreRegistryTagIndex";
import { IndexedTagCategory, normalizeTags, StoringMode } from "./types";
import {
  getSubtreeResourceMiddlewareAttachment,
  getSubtreeTaskMiddlewareAttachment,
} from "../../tools/subtreeMiddleware";
import { isReservedDefinitionLocalName } from "../../definers/assertDefinitionId";
import { resolveResourceSubtreeDeclarations } from "../../definers/subtreePolicy";
import { resolveIsolatePolicyDeclarations } from "../../definers/isolatePolicy";

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

type StoreRegistryAliasResolver = {
  registerDefinitionAlias: (reference: unknown, canonicalId: string) => void;
  resolveDefinitionId: (reference: unknown) => string | undefined;
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
    private readonly aliasResolver: StoreRegistryAliasResolver,
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
    this.aliasResolver.registerDefinitionAlias(item, item.id);
    this.validator.trackRegisteredId(item.id);
    const tags = this.normalizeDefinitionTags(item.tags);
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
    this.aliasResolver.registerDefinitionAlias(item, item.id);
    this.validator.trackRegisteredId(item.id);
  }

  storeTag(item: ITag<any, any, any>) {
    this.validator.checkIfIDExists(item.id);
    this.collections.tags.set(item.id, item);
    this.aliasResolver.registerDefinitionAlias(item, item.id);
    this.validator.trackRegisteredId(item.id);
  }

  storeHook<_C>(item: IHook<any, any>, overrideMode: StoringMode = "normal") {
    overrideMode === "normal" && this.validator.checkIfIDExists(item.id);

    const hook = this.definitionPreparer.prepareFreshValue({
      item,
      collection: this.collections.hooks,
      key: "hook",
      mode: overrideMode,
      overrideTargetType: "Hook",
    });

    this.collections.hooks.set(hook.id, {
      hook,
      computedDependencies: {},
      dependencyState: HookDependencyState.Pending,
    });
    this.aliasResolver.registerDefinitionAlias(item, hook.id);
    this.aliasResolver.registerDefinitionAlias(hook, hook.id);
    this.validator.trackRegisteredId(hook.id);
    const tags = this.normalizeDefinitionTags(hook.tags);
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
      overrideTargetType: "Task middleware",
    });

    this.collections.taskMiddlewares.set(middleware.id, {
      middleware,
      computedDependencies: {},
      isInitialized: false,
    });
    this.aliasResolver.registerDefinitionAlias(item, middleware.id);
    this.aliasResolver.registerDefinitionAlias(middleware, middleware.id);
    this.validator.trackRegisteredId(middleware.id);
    const tags = this.normalizeDefinitionTags(middleware.tags);
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.TaskMiddlewares,
      middleware.id,
      tags,
    );
    this.visibilityTracker.recordDefinitionTags(middleware.id, tags);
  }

  storeResourceMiddleware<_C>(
    item: IResourceMiddleware<any>,
    storingMode: StoringMode = "normal",
  ) {
    storingMode === "normal" && this.validator.checkIfIDExists(item.id);
    const middleware = this.definitionPreparer.prepareFreshValue({
      item,
      collection: this.collections.resourceMiddlewares,
      key: "middleware",
      mode: storingMode,
      overrideTargetType: "Resource middleware",
    });

    this.collections.resourceMiddlewares.set(middleware.id, {
      middleware,
      computedDependencies: {},
      isInitialized: false,
    });
    this.aliasResolver.registerDefinitionAlias(item, middleware.id);
    this.aliasResolver.registerDefinitionAlias(middleware, middleware.id);
    this.validator.trackRegisteredId(middleware.id);
    const tags = this.normalizeDefinitionTags(middleware.tags);
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
    this.aliasResolver.registerDefinitionAlias(item, item.id);
    this.validator.trackRegisteredId(item.id);
    const tags = this.normalizeDefinitionTags(item.tags);
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
      overrideTargetType: "Resource",
    });
    prepared.isolate = resolveIsolatePolicyDeclarations(
      prepared[symbolResourceIsolateDeclarations],
      item.config,
      prepared.id,
    );
    prepared.subtree = this.normalizeResourceSubtreeMiddlewareAttachments(
      prepared,
      item.config,
    );

    this.collections.resources.set(prepared.id, {
      resource: prepared,
      config: item.config,
      value: undefined,
      isInitialized: false,
      context: undefined,
    });
    this.aliasResolver.registerDefinitionAlias(item, prepared.id);
    this.aliasResolver.registerDefinitionAlias(item.resource, prepared.id);
    this.aliasResolver.registerDefinitionAlias(prepared, prepared.id);
    this.validator.trackRegisteredId(prepared.id);
    this.visibilityTracker.recordResource(prepared.id);
    this.visibilityTracker.recordIsolation(prepared.id, prepared.isolate);
    const tags = this.normalizeDefinitionTags(prepared.tags);
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
    const registerEntries =
      typeof element.register === "function"
        ? element.register(config as _C)
        : element.register;
    const items = registerEntries ?? [];
    this.assignNormalizedRegisterEntries(element, items);

    const scopedItems = items.map((item) =>
      this.compileOwnedItem(element.id, element.gateway === true, item),
    );

    for (const item of scopedItems) {
      this.visibilityTracker.recordOwnership(element.id, item);
      const itemId = this.resolveRegisterableId(item);
      try {
        this.storeGenericItem<_C>(item);
      } catch (error) {
        if (itemId) {
          this.visibilityTracker.rollbackOwnershipTree(itemId);
        }
        throw error;
      }
    }
  }

  private assignNormalizedRegisterEntries<_C>(
    element: IResource<_C>,
    items: RegisterableItems[],
  ): void {
    const descriptor = Object.getOwnPropertyDescriptor(element, "register");

    if (descriptor && descriptor.writable === false) {
      return;
    }

    element.register = items;
  }

  private compileOwnedItem(
    ownerResourceId: string,
    ownerIsGateway: boolean,
    item: RegisterableItems,
  ): RegisterableItems {
    const kind = resolveRegisterableKind(item);
    if (!kind) {
      return item;
    }

    if (kind === RegisterableKind.ResourceWithConfig) {
      const withConfig = item as IResourceWithConfig<any, any, any>;
      const compiledResource = this.compileOwnedDefinition(
        ownerResourceId,
        ownerIsGateway,
        withConfig.resource as RegisterableItems,
        RegisterableKind.Resource,
      ) as IResource<any, any, any>;
      const compiledWithConfig = this.cloneDefinitionWithId(
        withConfig as IResourceWithConfig<any, any, any> & { id: string },
        compiledResource.id,
      ) as IResourceWithConfig<any, any, any>;
      compiledWithConfig.resource = compiledResource;

      this.aliasResolver.registerDefinitionAlias(item, compiledResource.id);
      this.aliasResolver.registerDefinitionAlias(
        withConfig.resource,
        compiledResource.id,
      );
      this.aliasResolver.registerDefinitionAlias(
        compiledWithConfig,
        compiledResource.id,
      );
      this.aliasResolver.registerDefinitionAlias(
        compiledWithConfig.resource,
        compiledResource.id,
      );
      return compiledWithConfig;
    }

    const compiled = this.compileOwnedDefinition(
      ownerResourceId,
      ownerIsGateway,
      item,
      kind,
    );
    const resolvedId = this.resolveRegisterableId(compiled)!;
    this.aliasResolver.registerDefinitionAlias(item, resolvedId);
    this.aliasResolver.registerDefinitionAlias(compiled, resolvedId);
    return compiled;
  }

  private compileOwnedDefinition(
    ownerResourceId: string,
    ownerIsGateway: boolean,
    item: RegisterableItems,
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
  ): RegisterableItems {
    const currentId = item.id;
    const nextId = this.computeCanonicalId(
      ownerResourceId,
      ownerIsGateway,
      kind,
      currentId,
    );
    if (nextId === currentId) {
      return item;
    }

    return this.cloneDefinitionWithId(
      item as RegisterableItems & { id: string },
      nextId,
    );
  }

  private cloneDefinitionWithId<TDefinition extends { id: string }>(
    definition: TDefinition,
    id: string,
  ): TDefinition {
    const clone = Object.create(
      Object.getPrototypeOf(definition),
    ) as TDefinition;
    Object.assign(clone, definition);
    this.assignClonedDefinitionId(clone as object, id);
    return clone;
  }

  private assignClonedDefinitionId(target: object, id: string): void {
    const cloneWithDefinition = target as { definition?: unknown };
    const internalDefinition = cloneWithDefinition.definition;
    if (
      internalDefinition &&
      typeof internalDefinition === "object" &&
      "id" in internalDefinition &&
      typeof (internalDefinition as { id?: unknown }).id === "string"
    ) {
      cloneWithDefinition.definition = {
        ...(internalDefinition as Record<string, unknown>),
        id,
      };
    }

    const descriptor = Object.getOwnPropertyDescriptor(target, "id");
    if (descriptor?.writable) {
      (target as { id: string }).id = id;
      return;
    }

    Object.defineProperty(target, "id", {
      value: id,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  private computeCanonicalId(
    ownerResourceId: string,
    ownerIsGateway: boolean,
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
    currentId: string,
  ): string {
    this.assertLocalName(ownerResourceId, kind, currentId);

    if (currentId.startsWith(`${ownerResourceId}.`)) {
      return currentId;
    }

    if (ownerIsGateway) {
      switch (kind) {
        case RegisterableKind.Resource:
          return currentId;
        case RegisterableKind.Task:
          return `tasks.${currentId}`;
        case RegisterableKind.Event:
          return `events.${currentId}`;
        case RegisterableKind.Hook:
          return `hooks.${currentId}`;
        case RegisterableKind.TaskMiddleware:
          return `middleware.task.${currentId}`;
        case RegisterableKind.ResourceMiddleware:
          return `middleware.resource.${currentId}`;
        case RegisterableKind.Tag:
          return `tags.${currentId}`;
        case RegisterableKind.Error:
          return `errors.${currentId}`;
        case RegisterableKind.AsyncContext:
          return `asyncContexts.${currentId}`;
        default:
          return currentId;
      }
    }

    switch (kind) {
      case RegisterableKind.Resource:
        return `${ownerResourceId}.${currentId}`;
      case RegisterableKind.Task:
        return `${ownerResourceId}.tasks.${currentId}`;
      case RegisterableKind.Event:
        return `${ownerResourceId}.events.${currentId}`;
      case RegisterableKind.Hook:
        return `${ownerResourceId}.hooks.${currentId}`;
      case RegisterableKind.TaskMiddleware:
        return `${ownerResourceId}.middleware.task.${currentId}`;
      case RegisterableKind.ResourceMiddleware:
        return `${ownerResourceId}.middleware.resource.${currentId}`;
      case RegisterableKind.Tag:
        return `${ownerResourceId}.tags.${currentId}`;
      case RegisterableKind.Error:
        return `${ownerResourceId}.errors.${currentId}`;
      case RegisterableKind.AsyncContext:
        return `${ownerResourceId}.asyncContexts.${currentId}`;
      default:
        return `${ownerResourceId}.${currentId}`;
    }
  }

  private assertLocalName(
    ownerResourceId: string,
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
    currentId: string,
  ) {
    if (currentId.trim().length === 0) {
      validationError.throw({
        subject: "Definition local name",
        id: `${ownerResourceId}.${kind}`,
        originalError:
          "Definition local names must be non-empty strings when using scoped registration.",
      });
    }

    if (isReservedDefinitionLocalName(currentId)) {
      validationError.throw({
        subject: "Definition local name",
        id: `${ownerResourceId}.${kind}.${currentId}`,
        originalError: `Local name "${currentId}" is reserved by Runner and cannot be used.`,
      });
    }
  }

  private resolveRegisterableId(item: RegisterableItems): string | undefined {
    if (item === null || item === undefined) {
      return undefined;
    }

    if (hasSymbolBrand(item, symbolResourceWithConfig)) {
      return (item as IResourceWithConfig<any, any, any>).resource.id;
    }

    if (typeof item === "object" && "id" in item) {
      return (item as { id: string }).id;
    }

    return undefined;
  }

  storeResource<_C>(
    item: IResource<any, any, any>,
    overrideMode: StoringMode = "normal",
  ) {
    overrideMode === "normal" && this.validator.checkIfIDExists(item.id);
    const existingResourceEntry =
      overrideMode === "override"
        ? this.collections.resources.get(item.id)
        : undefined;
    const configForResource =
      overrideMode === "override" ? existingResourceEntry!.config : {};

    const prepared = this.definitionPreparer.prepareFreshValue({
      item,
      collection: this.collections.resources,
      key: "resource",
      mode: overrideMode,
      config: configForResource,
      overrideTargetType: "Resource",
    });
    prepared.isolate = resolveIsolatePolicyDeclarations(
      prepared[symbolResourceIsolateDeclarations],
      configForResource,
      prepared.id,
    );
    prepared.middleware = this.normalizeResourceMiddlewareAttachments(prepared);
    prepared.subtree = this.normalizeResourceSubtreeMiddlewareAttachments(
      prepared,
      configForResource as _C,
    );

    this.collections.resources.set(prepared.id, {
      resource: prepared,
      config: configForResource,
      value: undefined,
      isInitialized: false,
      context: undefined,
    });
    this.aliasResolver.registerDefinitionAlias(item, prepared.id);
    this.aliasResolver.registerDefinitionAlias(prepared, prepared.id);
    this.validator.trackRegisteredId(prepared.id);
    this.visibilityTracker.recordResource(prepared.id);
    this.visibilityTracker.recordIsolation(prepared.id, prepared.isolate);
    const tags = this.normalizeDefinitionTags(prepared.tags);
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.Resources,
      prepared.id,
      tags,
    );
    this.visibilityTracker.recordDefinitionTags(prepared.id, tags);

    this.computeRegistrationDeeply(prepared, configForResource as _C);
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
      overrideTargetType: "Task",
    });
    task.middleware = this.normalizeTaskMiddlewareAttachments(task);

    this.collections.tasks.set(task.id, {
      task,
      computedDependencies: {},
      isInitialized: false,
    });
    this.aliasResolver.registerDefinitionAlias(item, task.id);
    this.aliasResolver.registerDefinitionAlias(task, task.id);
    this.validator.trackRegisteredId(task.id);
    const tags = this.normalizeDefinitionTags(task.tags);
    this.tagIndex.reindexDefinitionTags(
      IndexedTagCategory.Tasks,
      task.id,
      tags,
    );
    this.visibilityTracker.recordDefinitionTags(task.id, tags);
  }

  private normalizeTaskMiddlewareAttachments(
    task: ITask<any, any, {}>,
  ): ITask<any, any, {}>["middleware"] {
    return this.normalizeMiddlewareAttachments(
      this.resolveOwnerResourceIdFromTaskId(task.id),
      RegisterableKind.TaskMiddleware,
      task.middleware,
    );
  }

  private normalizeResourceMiddlewareAttachments(
    resource: IResource<any, any, any>,
  ): IResource<any, any, any>["middleware"] {
    return this.normalizeMiddlewareAttachments(
      resource.id,
      RegisterableKind.ResourceMiddleware,
      resource.middleware,
    );
  }

  private normalizeResourceSubtreeMiddlewareAttachments(
    resource: IResource<any, any, any>,
    config: unknown,
  ): IResource<any, any, any>["subtree"] {
    const subtree = resolveResourceSubtreeDeclarations(
      resource[symbolResourceSubtreeDeclarations],
      config,
    );
    if (!subtree) {
      return subtree;
    }

    let hasChanges = false;
    let normalizedTaskPolicy = subtree.tasks;
    let normalizedResourcePolicy = subtree.resources;

    if (subtree.tasks?.middleware?.length) {
      const middleware = subtree.tasks.middleware.map((entry) =>
        this.normalizeSubtreeTaskMiddlewareEntry(resource.id, entry),
      );
      if (this.didArrayChange(subtree.tasks.middleware, middleware)) {
        normalizedTaskPolicy = {
          ...subtree.tasks,
          middleware,
        };
        hasChanges = true;
      }
    }

    if (subtree.resources?.middleware?.length) {
      const middleware = subtree.resources.middleware.map((entry) =>
        this.normalizeSubtreeResourceMiddlewareEntry(resource.id, entry),
      );
      if (this.didArrayChange(subtree.resources.middleware, middleware)) {
        normalizedResourcePolicy = {
          ...subtree.resources,
          middleware,
        };
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      return subtree;
    }

    return {
      ...subtree,
      ...(normalizedTaskPolicy ? { tasks: normalizedTaskPolicy } : {}),
      ...(normalizedResourcePolicy
        ? { resources: normalizedResourcePolicy }
        : {}),
    };
  }

  private normalizeSubtreeTaskMiddlewareEntry(
    ownerResourceId: string,
    entry: SubtreeTaskMiddlewareEntry,
  ) {
    return this.normalizeSubtreeMiddlewareEntry(
      ownerResourceId,
      RegisterableKind.TaskMiddleware,
      entry,
      getSubtreeTaskMiddlewareAttachment,
    );
  }

  private normalizeSubtreeResourceMiddlewareEntry(
    ownerResourceId: string,
    entry: SubtreeResourceMiddlewareEntry,
  ) {
    return this.normalizeSubtreeMiddlewareEntry(
      ownerResourceId,
      RegisterableKind.ResourceMiddleware,
      entry,
      getSubtreeResourceMiddlewareAttachment,
    );
  }

  private normalizeMiddlewareAttachments<TAttachment extends { id: string }>(
    ownerResourceId: string | null,
    kind: RegisterableKind.TaskMiddleware | RegisterableKind.ResourceMiddleware,
    attachments: TAttachment[],
  ): TAttachment[] {
    if (!Array.isArray(attachments) || attachments.length === 0) {
      return attachments;
    }

    if (!ownerResourceId) {
      return attachments;
    }

    return attachments.map((attachment) =>
      this.normalizeMiddlewareAttachment(ownerResourceId, kind, attachment),
    );
  }

  private normalizeSubtreeMiddlewareEntry<
    TAttachment extends { id: string },
    TEntry extends TAttachment | ({ use: TAttachment } & object),
  >(
    ownerResourceId: string,
    kind: RegisterableKind.TaskMiddleware | RegisterableKind.ResourceMiddleware,
    entry: TEntry,
    getAttachment: (entry: TEntry) => TAttachment,
  ): TEntry {
    const attachment = getAttachment(entry);
    const normalizedAttachment = this.normalizeMiddlewareAttachment(
      ownerResourceId,
      kind,
      attachment,
    );

    if (normalizedAttachment === attachment) {
      return entry;
    }

    if ("use" in entry) {
      return {
        ...(entry as object),
        use: normalizedAttachment,
      } as TEntry;
    }

    return normalizedAttachment as TEntry;
  }

  private normalizeMiddlewareAttachment<TAttachment extends { id: string }>(
    ownerResourceId: string,
    kind: RegisterableKind.TaskMiddleware | RegisterableKind.ResourceMiddleware,
    attachment: TAttachment,
  ): TAttachment {
    const ownerIsGateway =
      this.collections.resources.get(ownerResourceId)?.resource.gateway ===
      true;
    const isRegisteredMiddlewareId = (candidateId: string): boolean =>
      kind === RegisterableKind.TaskMiddleware
        ? this.collections.taskMiddlewares.has(candidateId)
        : this.collections.resourceMiddlewares.has(candidateId);
    const resolvedByAliasCandidate =
      this.aliasResolver.resolveDefinitionId(attachment);
    const resolvedByAlias =
      typeof resolvedByAliasCandidate === "string" &&
      isRegisteredMiddlewareId(resolvedByAliasCandidate)
        ? resolvedByAliasCandidate
        : undefined;
    const resolvedId =
      resolvedByAlias ??
      this.computeCanonicalId(
        ownerResourceId,
        ownerIsGateway,
        kind,
        attachment.id,
      );

    if (resolvedId === attachment.id) {
      return attachment;
    }

    const normalized = this.cloneDefinitionWithId(
      attachment as TAttachment & { id: string },
      resolvedId,
    );
    this.aliasResolver.registerDefinitionAlias(attachment, resolvedId);
    this.aliasResolver.registerDefinitionAlias(normalized, resolvedId);
    return normalized;
  }

  private resolveOwnerResourceIdFromTaskId(taskId: string): string | null {
    const separator = ".tasks.";
    const separatorIndex = taskId.lastIndexOf(separator);
    if (separatorIndex < 0) {
      return null;
    }
    return taskId.slice(0, separatorIndex);
  }

  private didArrayChange<T>(
    source: ReadonlyArray<T>,
    next: ReadonlyArray<T>,
  ): boolean {
    if (source.length !== next.length) {
      return true;
    }

    for (let index = 0; index < source.length; index += 1) {
      if (source[index] !== next[index]) {
        return true;
      }
    }

    return false;
  }

  private normalizeDefinitionTags(
    tags: ReadonlyArray<{ id: string }> | undefined,
  ): TagType[] {
    return normalizeTags(tags).map((tag) => {
      const resolvedId = this.aliasResolver.resolveDefinitionId(tag);
      if (!resolvedId || resolvedId === tag.id) {
        return tag;
      }

      return this.cloneDefinitionWithId(
        tag as TagType & { id: string },
        resolvedId,
      );
    });
  }
}
