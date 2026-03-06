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
  symbolTagConfiguredFrom,
} from "../defs";
import { isResourceWithConfig } from "../define";
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
import { validationError } from "../errors";
import { getDefinitionIdentity } from "../tools/isSameDefinition";

/**
 * Any object reference used as a definition identity key.
 * Kept as `object` because WeakMap requires non-primitive keys
 * and these functions work at the raw metadata layer before element type narrowing.
 */
type DefinitionReference = object;

type DefinitionReferenceWithOptionalId = {
  id?: unknown;
};

type DefinitionReferenceWithConfiguredFrom = {
  [symbolTagConfiguredFrom]?: unknown;
};

function isObjectReference(value: unknown): value is DefinitionReference {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  );
}

function getReferenceSourceId(
  reference: DefinitionReference,
): string | undefined {
  if (!("id" in reference)) {
    return undefined;
  }

  const sourceId = (reference as DefinitionReferenceWithOptionalId).id;
  return typeof sourceId === "string" && sourceId.length > 0
    ? sourceId
    : undefined;
}

function getConfiguredFromReference(
  reference: DefinitionReference,
): DefinitionReference | undefined {
  const configuredFrom = (reference as DefinitionReferenceWithConfiguredFrom)[
    symbolTagConfiguredFrom
  ];

  return isObjectReference(configuredFrom) ? configuredFrom : undefined;
}

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
  private readonly definitionAliases = new WeakMap<
    DefinitionReference,
    string
  >();
  private readonly definitionIdentityAliases = new WeakMap<
    DefinitionReference,
    string
  >();
  private readonly definitionAliasesBySourceId = new Map<string, Set<string>>();
  private readonly sourceIdsByCanonicalId = new Map<string, Set<string>>();

  // Kept on the registry for backward compatibility in tests/tools.
  public readonly tagIndex: Map<string, TagIndexBucket>;

  private readonly validator: StoreValidator;
  private readonly tagIndexer: StoreRegistryTagIndex;
  private readonly writer: StoreRegistryWriter;

  constructor(protected readonly store: Store) {
    const lookupResolver = (key: string): string | undefined =>
      this.resolveDefinitionId(key);
    this.tasks.setLookupResolver(lookupResolver);
    this.resources.setLookupResolver(lookupResolver);
    this.events.setLookupResolver(lookupResolver);
    this.taskMiddlewares.setLookupResolver(lookupResolver);
    this.resourceMiddlewares.setLookupResolver(lookupResolver);
    this.hooks.setLookupResolver(lookupResolver);
    this.tags.setLookupResolver(lookupResolver);
    this.asyncContexts.setLookupResolver(lookupResolver);
    this.errors.setLookupResolver(lookupResolver);

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
      (reference) => this.resolveDefinitionId(reference),
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
      {
        registerDefinitionAlias: (reference, canonicalId) =>
          this.registerDefinitionAlias(reference, canonicalId),
        resolveDefinitionId: (reference) => this.resolveDefinitionId(reference),
      },
    );
  }

  getValidator(): StoreValidator {
    return this.validator;
  }

  registerDefinitionAlias(reference: unknown, canonicalId: string): void {
    if (!isObjectReference(reference)) {
      return;
    }

    const existing = this.definitionAliases.get(reference);
    if (existing && existing !== canonicalId) {
      validationError.throw({
        subject: "Definition alias",
        id: canonicalId,
        originalError: `Definition reference is already mapped to "${existing}" and cannot be remapped to "${canonicalId}". Use .fork() for distinct registrations.`,
      });
    }

    this.definitionAliases.set(reference, canonicalId);
    this.recordDefinitionIdentityAlias(reference, canonicalId);
    this.recordSourceIdAlias(reference, canonicalId);
    this.recordCanonicalSourceId(reference, canonicalId);
  }

  resolveDefinitionId(reference: unknown): string | undefined {
    if (typeof reference === "string") {
      return this.resolveUniqueSourceIdAlias(reference) ?? reference;
    }

    if (!isObjectReference(reference)) {
      return undefined;
    }

    const mapped = this.definitionAliases.get(reference);
    if (mapped) {
      return mapped;
    }

    const identity = getDefinitionIdentity(reference);
    if (identity) {
      const byIdentity = this.definitionIdentityAliases.get(identity);
      if (byIdentity) {
        return byIdentity;
      }
    }

    const configuredFrom = getConfiguredFromReference(reference);
    if (configuredFrom) {
      const byConfiguredFrom = this.definitionAliases.get(configuredFrom);
      if (byConfiguredFrom) {
        return byConfiguredFrom;
      }
    }

    if (isResourceWithConfig(reference)) {
      const byResource = this.definitionAliases.get(reference.resource);
      if (byResource) {
        return byResource;
      }
      return reference.resource.id;
    }

    const sourceId = getReferenceSourceId(reference);
    if (sourceId) {
      return this.resolveUniqueSourceIdAlias(sourceId) ?? sourceId;
    }

    return undefined;
  }

  private recordDefinitionIdentityAlias(
    reference: DefinitionReference,
    canonicalId: string,
  ): void {
    const identity = getDefinitionIdentity(reference);
    if (!identity) {
      return;
    }

    const existing = this.definitionIdentityAliases.get(identity);
    if (existing && existing !== canonicalId) {
      validationError.throw({
        subject: "Definition identity alias",
        id: canonicalId,
        originalError: `Definition identity is already mapped to "${existing}" and cannot be remapped to "${canonicalId}". Use .fork() for distinct registrations.`,
      });
    }

    this.definitionIdentityAliases.set(identity, canonicalId);
  }

  private recordSourceIdAlias(
    reference: DefinitionReference,
    canonicalId: string,
  ): void {
    const sourceId = getReferenceSourceId(reference);
    if (!sourceId) {
      return;
    }

    const existing = this.definitionAliasesBySourceId.get(sourceId);
    if (existing) {
      existing.add(canonicalId);
      return;
    }

    this.definitionAliasesBySourceId.set(sourceId, new Set([canonicalId]));
  }

  private recordCanonicalSourceId(
    reference: DefinitionReference,
    canonicalId: string,
  ): void {
    const sourceId = getReferenceSourceId(reference);
    if (!sourceId) {
      return;
    }

    const existing = this.sourceIdsByCanonicalId.get(canonicalId);
    if (existing) {
      existing.add(sourceId);
      return;
    }

    this.sourceIdsByCanonicalId.set(canonicalId, new Set([sourceId]));
  }

  private resolveUniqueSourceIdAlias(sourceId: string): string | undefined {
    const candidates = this.definitionAliasesBySourceId.get(sourceId);
    if (!candidates || candidates.size !== 1) {
      return undefined;
    }

    return candidates.values().next().value as string;
  }

  getDisplayId(id: string): string {
    const sourceIds = this.sourceIdsByCanonicalId.get(id);
    if (!sourceIds || sourceIds.size === 0) {
      return id;
    }

    for (const sourceId of sourceIds) {
      if (sourceId !== id) {
        return sourceId;
      }
    }

    return sourceIds.values().next().value as string;
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
    const normalizedOptions = options?.consumerId
      ? {
          ...options,
          consumerId:
            this.resolveDefinitionId(options.consumerId) ?? options.consumerId,
        }
      : options;
    const resolvedTagId = this.resolveDefinitionId(tag);
    if (!resolvedTagId || resolvedTagId === tag.id) {
      return this.tagIndexer.getTagAccessor(tag, normalizedOptions);
    }

    const canonicalTag = {
      ...tag,
      id: resolvedTagId,
    } as TTag;
    return this.tagIndexer.getTagAccessor(canonicalTag, normalizedOptions);
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
  getTasksWithTag(tag: ITag<any, any, any>): AnyTask[] {
    return this.getTagAccessor(tag).tasks.map((entry) => entry.definition);
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
  getResourcesWithTag(tag: ITag<any, any, any>): AnyResource[] {
    return this.getTagAccessor(tag).resources.map((entry) => entry.definition);
  }
}
