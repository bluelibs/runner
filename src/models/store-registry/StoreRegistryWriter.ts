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
  symbolResourceIsolateDeclarations,
  symbolResourceSubtreeDeclarations,
} from "../../defs";
import { unknownItemTypeError } from "../../errors";
import { IAsyncContext } from "../../types/asyncContext";
import { IErrorHelper } from "../../types/error";
import type { RunnerMode } from "../../types/runner";
import { HookDependencyState } from "../../types/storeTypes";
import { VisibilityTracker } from "../VisibilityTracker";
import { StoreRegistryDefinitionPreparer } from "./StoreRegistryDefinitionPreparer";
import { RegisterableKind, resolveRegisterableKind } from "./registerableKind";
import { StoreRegistryTagIndex } from "./StoreRegistryTagIndex";
import { IndexedTagCategory, normalizeTags, StoringMode } from "./types";
import { CanonicalIdCompiler } from "./CanonicalIdCompiler";
import { createOwnerScope, type OwnerScope } from "./OwnerScope";
import {
  getSubtreeResourceMiddlewareAttachment,
  getSubtreeTaskMiddlewareAttachment,
} from "../../tools/subtreeMiddleware";
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

export class StoreRegistryWriter {
  private readonly canonicalIdCompiler = new CanonicalIdCompiler();

  constructor(
    private readonly collections: StoreRegistryCollections,
    private readonly validator: StoreRegistryValidation,
    private readonly visibilityTracker: VisibilityTracker,
    private readonly tagIndex: StoreRegistryTagIndex,
    private readonly definitionPreparer: StoreRegistryDefinitionPreparer,
    private readonly aliasResolver: StoreRegistryAliasResolver,
    private readonly getRuntimeMode: () => RunnerMode,
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
      runtimeMode: this.getRuntimeMode(),
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
      runtimeMode: this.getRuntimeMode(),
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
      runtimeMode: this.getRuntimeMode(),
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
      runtimeMode: this.getRuntimeMode(),
      overrideTargetType: "Resource",
    });
    prepared.isolate = resolveIsolatePolicyDeclarations(
      prepared[symbolResourceIsolateDeclarations],
      item.config,
      this.getRuntimeMode(),
      prepared.id,
    );
    prepared.subtree = this.normalizeResourceSubtreeMiddlewareAttachments(
      prepared,
      item.config,
      this.getRuntimeMode(),
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

    this.computeRegistrationDeeply(
      prepared,
      item.config,
      this.getRuntimeMode(),
    );
    return prepared;
  }

  computeRegistrationDeeply<_C>(
    element: IResource<_C>,
    config: _C | undefined,
    runtimeMode: RunnerMode,
  ) {
    const registerEntries =
      typeof element.register === "function"
        ? element.register(config as _C, runtimeMode)
        : element.register;
    const items = registerEntries ?? [];
    this.assignNormalizedRegisterEntries(element, items);

    const ownerScope = createOwnerScope(element.id);
    const scopedItems = items.map((item) =>
      this.compileOwnedItem(ownerScope, item),
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
    ownerScope: OwnerScope,
    item: RegisterableItems,
  ): RegisterableItems {
    const kind = resolveRegisterableKind(item);
    if (!kind) {
      return item;
    }

    if (kind === RegisterableKind.ResourceWithConfig) {
      const withConfig = item as IResourceWithConfig<any, any, any>;
      const compiledResource = this.compileOwnedDefinitionWithScope(
        ownerScope,
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

    const compiled = this.compileOwnedDefinitionWithScope(
      ownerScope,
      item,
      kind,
    );
    const resolvedId = this.resolveRegisterableId(compiled)!;
    this.aliasResolver.registerDefinitionAlias(item, resolvedId);
    this.aliasResolver.registerDefinitionAlias(compiled, resolvedId);
    return compiled;
  }

  private compileOwnedDefinitionWithScope(
    ownerScope: OwnerScope,
    item: RegisterableItems,
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
  ): RegisterableItems {
    const currentId = item.id;
    const nextId = this.canonicalIdCompiler.compute(
      ownerScope,
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

  public computeCanonicalId(
    ownerResourceId: string,
    ownerUsesFrameworkRootIds: boolean,
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
    currentId: string,
  ): string {
    return this.canonicalIdCompiler.compute(
      {
        resourceId: ownerResourceId,
        usesFrameworkRootIds: ownerUsesFrameworkRootIds,
      },
      kind,
      currentId,
    );
  }

  public compileOwnedDefinition(
    ownerResourceId: string,
    ownerUsesFrameworkRootIds: boolean,
    item: RegisterableItems,
    kind: Exclude<RegisterableKind, RegisterableKind.ResourceWithConfig>,
  ): RegisterableItems {
    return this.compileOwnedDefinitionWithScope(
      {
        resourceId: ownerResourceId,
        usesFrameworkRootIds: ownerUsesFrameworkRootIds,
      },
      item,
      kind,
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

  private resolveRegisterableId(item: RegisterableItems): string | undefined {
    if (item === null || item === undefined) {
      return undefined;
    }

    if (resolveRegisterableKind(item) === RegisterableKind.ResourceWithConfig) {
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
      runtimeMode: this.getRuntimeMode(),
      overrideTargetType: "Resource",
    });
    prepared.isolate = resolveIsolatePolicyDeclarations(
      prepared[symbolResourceIsolateDeclarations],
      configForResource,
      this.getRuntimeMode(),
      prepared.id,
    );
    prepared.middleware = this.normalizeResourceMiddlewareAttachments(prepared);
    prepared.subtree = this.normalizeResourceSubtreeMiddlewareAttachments(
      prepared,
      configForResource as _C,
      this.getRuntimeMode(),
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

    this.computeRegistrationDeeply(
      prepared,
      configForResource as _C,
      this.getRuntimeMode(),
    );
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
      runtimeMode: this.getRuntimeMode(),
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
    const ownerResourceId = this.resolveOwnerResourceIdFromTaskId(task.id);
    return this.normalizeMiddlewareAttachments(
      ownerResourceId ? createOwnerScope(ownerResourceId) : null,
      RegisterableKind.TaskMiddleware,
      task.middleware,
    );
  }

  private normalizeResourceMiddlewareAttachments(
    resource: IResource<any, any, any>,
  ): IResource<any, any, any>["middleware"] {
    return this.normalizeMiddlewareAttachments(
      createOwnerScope(resource.id),
      RegisterableKind.ResourceMiddleware,
      resource.middleware,
    );
  }

  private normalizeResourceSubtreeMiddlewareAttachments(
    resource: IResource<any, any, any>,
    config: unknown,
    runtimeMode: RunnerMode,
  ): IResource<any, any, any>["subtree"] {
    const subtree = resolveResourceSubtreeDeclarations(
      resource[symbolResourceSubtreeDeclarations],
      config,
      runtimeMode,
    );
    if (!subtree) {
      return subtree;
    }

    let hasChanges = false;
    let normalizedTaskPolicy = subtree.tasks;
    let normalizedResourcePolicy = subtree.resources;

    if (subtree.tasks?.middleware?.length) {
      const middleware = subtree.tasks.middleware.map((entry) =>
        this.normalizeSubtreeTaskMiddlewareEntry(
          createOwnerScope(resource.id),
          entry,
        ),
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
        this.normalizeSubtreeResourceMiddlewareEntry(
          createOwnerScope(resource.id),
          entry,
        ),
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
    ownerScopeOrResourceId: OwnerScope | string,
    entryOrUsesFrameworkRootIds: SubtreeTaskMiddlewareEntry | boolean,
    maybeEntry?: SubtreeTaskMiddlewareEntry,
  ) {
    const ownerScope = this.normalizeOwnerScopeArg(
      ownerScopeOrResourceId,
      entryOrUsesFrameworkRootIds,
    );
    const entry =
      maybeEntry ?? (entryOrUsesFrameworkRootIds as SubtreeTaskMiddlewareEntry);
    return this.normalizeSubtreeMiddlewareEntry(
      ownerScope,
      RegisterableKind.TaskMiddleware,
      entry,
      getSubtreeTaskMiddlewareAttachment,
    );
  }

  private normalizeSubtreeResourceMiddlewareEntry(
    ownerScopeOrResourceId: OwnerScope | string,
    entryOrUsesFrameworkRootIds: SubtreeResourceMiddlewareEntry | boolean,
    maybeEntry?: SubtreeResourceMiddlewareEntry,
  ) {
    const ownerScope = this.normalizeOwnerScopeArg(
      ownerScopeOrResourceId,
      entryOrUsesFrameworkRootIds,
    );
    const entry =
      maybeEntry ??
      (entryOrUsesFrameworkRootIds as SubtreeResourceMiddlewareEntry);
    return this.normalizeSubtreeMiddlewareEntry(
      ownerScope,
      RegisterableKind.ResourceMiddleware,
      entry,
      getSubtreeResourceMiddlewareAttachment,
    );
  }

  private normalizeMiddlewareAttachments<TAttachment extends { id: string }>(
    ownerScope: OwnerScope | null,
    kind: RegisterableKind.TaskMiddleware | RegisterableKind.ResourceMiddleware,
    attachments: TAttachment[],
  ): TAttachment[] {
    if (!Array.isArray(attachments) || attachments.length === 0) {
      return attachments;
    }

    if (!ownerScope) {
      return attachments;
    }

    return attachments.map((attachment) =>
      this.normalizeMiddlewareAttachment(ownerScope, kind, attachment),
    );
  }

  private normalizeSubtreeMiddlewareEntry<
    TAttachment extends { id: string },
    TEntry extends TAttachment | ({ use: TAttachment } & object),
  >(
    ownerScope: OwnerScope,
    kind: RegisterableKind.TaskMiddleware | RegisterableKind.ResourceMiddleware,
    entry: TEntry,
    getAttachment: (entry: TEntry) => TAttachment,
  ): TEntry {
    const attachment = getAttachment(entry);
    const normalizedAttachment = this.normalizeMiddlewareAttachment(
      ownerScope,
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
    ownerScope: OwnerScope,
    kind: RegisterableKind.TaskMiddleware | RegisterableKind.ResourceMiddleware,
    attachment: TAttachment,
  ): TAttachment {
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
      this.canonicalIdCompiler.compute(ownerScope, kind, attachment.id);

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

  private normalizeOwnerScopeArg<TEntry>(
    ownerScopeOrResourceId: OwnerScope | string,
    entryOrUsesFrameworkRootIds: TEntry | boolean,
  ): OwnerScope {
    if (typeof ownerScopeOrResourceId !== "string") {
      return ownerScopeOrResourceId;
    }

    return {
      resourceId: ownerScopeOrResourceId,
      usesFrameworkRootIds:
        typeof entryOrUsesFrameworkRootIds === "boolean"
          ? entryOrUsesFrameworkRootIds
          : false,
    };
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
