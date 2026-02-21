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
  TagType,
  TaggedTask,
  TaggedResource,
  TagDependencyAccessor,
  TagDependencyTaskMatch,
  TagDependencyResourceMatch,
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
type IndexedTagCategory =
  | "tasks"
  | "resources"
  | "events"
  | "hooks"
  | "taskMiddlewares"
  | "resourceMiddlewares"
  | "errors";

type TagIndexBucket = Record<IndexedTagCategory, Set<string>>;

const indexedTagCategories: readonly IndexedTagCategory[] = [
  "tasks",
  "resources",
  "events",
  "hooks",
  "taskMiddlewares",
  "resourceMiddlewares",
  "errors",
];

const createTagIndexBucket = (): TagIndexBucket => ({
  tasks: new Set<string>(),
  resources: new Set<string>(),
  events: new Set<string>(),
  hooks: new Set<string>(),
  taskMiddlewares: new Set<string>(),
  resourceMiddlewares: new Set<string>(),
  errors: new Set<string>(),
});

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

  private readonly tagIndex = new Map<string, TagIndexBucket>();
  private readonly tagMembershipByCategory: Record<
    IndexedTagCategory,
    Map<string, Set<string>>
  > = {
    tasks: new Map<string, Set<string>>(),
    resources: new Map<string, Set<string>>(),
    events: new Map<string, Set<string>>(),
    hooks: new Map<string, Set<string>>(),
    taskMiddlewares: new Map<string, Set<string>>(),
    resourceMiddlewares: new Map<string, Set<string>>(),
    errors: new Map<string, Set<string>>(),
  };

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
    this.reindexDefinitionTags(
      "errors",
      item.id,
      this.normalizeTags(item.tags),
    );
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
    this.reindexDefinitionTags("hooks", hook.id, this.normalizeTags(hook.tags));
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
    this.reindexDefinitionTags(
      "taskMiddlewares",
      middleware.id,
      this.normalizeTags(middleware.tags),
    );
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
    this.reindexDefinitionTags(
      "resourceMiddlewares",
      middleware.id,
      this.normalizeTags(middleware.tags),
    );
  }

  storeEvent<_C>(item: IEvent<void>) {
    this.validator.checkIfIDExists(item.id);
    this.events.set(item.id, { event: item });
    this.reindexDefinitionTags(
      "events",
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
    this.reindexDefinitionTags(
      "resources",
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
    this.reindexDefinitionTags(
      "resources",
      prepared.id,
      this.normalizeTags(prepared.tags),
    );

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
    this.reindexDefinitionTags("tasks", task.id, this.normalizeTags(task.tags));
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

    const bucket = this.tagIndex.get(tag.id);

    let tasksCache: TagDependencyAccessor<TTag>["tasks"] | undefined;
    let resourcesCache: TagDependencyAccessor<TTag>["resources"] | undefined;
    let eventsCache: TagDependencyAccessor<TTag>["events"] | undefined;
    let hooksCache: TagDependencyAccessor<TTag>["hooks"] | undefined;
    let taskMiddlewaresCache:
      | TagDependencyAccessor<TTag>["taskMiddlewares"]
      | undefined;
    let resourceMiddlewaresCache:
      | TagDependencyAccessor<TTag>["resourceMiddlewares"]
      | undefined;
    let errorsCache: TagDependencyAccessor<TTag>["errors"] | undefined;

    const readTasks = (): TagDependencyAccessor<TTag>["tasks"] => {
      if (!tasksCache) {
        tasksCache = Object.freeze(
          this.collectTaggedTaskMatches(tag, bucket?.tasks, isIncluded),
        );
      }
      return tasksCache;
    };

    const readResources = (): TagDependencyAccessor<TTag>["resources"] => {
      if (!resourcesCache) {
        resourcesCache = Object.freeze(
          this.collectTaggedResourceMatches(tag, bucket?.resources, isIncluded),
        );
      }
      return resourcesCache;
    };

    const readEvents = (): TagDependencyAccessor<TTag>["events"] => {
      if (!eventsCache) {
        eventsCache = Object.freeze(
          this.collectGenericTaggedMatches(
            tag,
            bucket?.events,
            (id) => {
              const entry = this.events.get(id);
              if (!entry) {
                return undefined;
              }
              return {
                definition: entry.event,
                tags: this.normalizeTags(entry.event.tags),
              };
            },
            isIncluded,
          ),
        );
      }
      return eventsCache;
    };

    const readHooks = (): TagDependencyAccessor<TTag>["hooks"] => {
      if (!hooksCache) {
        hooksCache = Object.freeze(
          this.collectGenericTaggedMatches(
            tag,
            bucket?.hooks,
            (id) => {
              const entry = this.hooks.get(id);
              if (!entry) {
                return undefined;
              }
              return {
                definition: entry.hook,
                tags: this.normalizeTags(entry.hook.tags),
              };
            },
            isIncluded,
          ),
        );
      }
      return hooksCache;
    };

    const readTaskMiddlewares =
      (): TagDependencyAccessor<TTag>["taskMiddlewares"] => {
        if (!taskMiddlewaresCache) {
          taskMiddlewaresCache = Object.freeze(
            this.collectGenericTaggedMatches(
              tag,
              bucket?.taskMiddlewares,
              (id) => {
                const entry = this.taskMiddlewares.get(id);
                if (!entry) {
                  return undefined;
                }
                return {
                  definition: entry.middleware,
                  tags: this.normalizeTags(entry.middleware.tags),
                };
              },
              isIncluded,
            ),
          );
        }
        return taskMiddlewaresCache;
      };

    const readResourceMiddlewares =
      (): TagDependencyAccessor<TTag>["resourceMiddlewares"] => {
        if (!resourceMiddlewaresCache) {
          resourceMiddlewaresCache = Object.freeze(
            this.collectGenericTaggedMatches(
              tag,
              bucket?.resourceMiddlewares,
              (id) => {
                const entry = this.resourceMiddlewares.get(id);
                if (!entry) {
                  return undefined;
                }
                return {
                  definition: entry.middleware,
                  tags: this.normalizeTags(entry.middleware.tags),
                };
              },
              isIncluded,
            ),
          );
        }
        return resourceMiddlewaresCache;
      };

    const readErrors = (): TagDependencyAccessor<TTag>["errors"] => {
      if (!errorsCache) {
        errorsCache = Object.freeze(
          this.collectGenericTaggedMatches(
            tag,
            bucket?.errors,
            (id) => {
              const entry = this.errors.get(id);
              if (!entry) {
                return undefined;
              }
              return {
                definition: entry,
                tags: this.normalizeTags(entry.tags),
              };
            },
            isIncluded,
          ),
        );
      }
      return errorsCache;
    };

    const accessor: TagDependencyAccessor<TTag> = {
      get tasks() {
        return readTasks();
      },
      get resources() {
        return readResources();
      },
      get events() {
        return readEvents();
      },
      get hooks() {
        return readHooks();
      },
      get taskMiddlewares() {
        return readTaskMiddlewares();
      },
      get resourceMiddlewares() {
        return readResourceMiddlewares();
      },
      get errors() {
        return readErrors();
      },
    };

    return Object.freeze(accessor);
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

  private collectTaggedTaskMatches<TTag extends ITag<any, any, any>>(
    tag: TTag,
    definitionIds: ReadonlySet<string> | undefined,
    isIncluded: (definitionId: string) => boolean,
  ): TagDependencyAccessor<TTag>["tasks"] {
    if (!definitionIds || definitionIds.size === 0) {
      return [];
    }

    const matches: TagDependencyTaskMatch<TTag>[] = [];
    for (const definitionId of definitionIds) {
      const storeEntry = this.tasks.get(definitionId);
      if (!storeEntry) {
        continue;
      }
      if (!isIncluded(storeEntry.task.id)) {
        continue;
      }

      const tags = this.normalizeTags(storeEntry.task.tags);
      if (!this.hasTagId(tags, tag.id)) {
        continue;
      }

      matches.push({
        definition: storeEntry.task as TaggedTask<TTag>,
        config: this.readTagConfig(tag, tags),
      });
    }

    return matches;
  }

  private collectTaggedResourceMatches<TTag extends ITag<any, any, any>>(
    tag: TTag,
    definitionIds: ReadonlySet<string> | undefined,
    isIncluded: (definitionId: string) => boolean,
  ): TagDependencyAccessor<TTag>["resources"] {
    if (!definitionIds || definitionIds.size === 0) {
      return [];
    }

    const matches: TagDependencyResourceMatch<TTag>[] = [];
    for (const definitionId of definitionIds) {
      const storeEntry = this.resources.get(definitionId);
      if (!storeEntry) {
        continue;
      }
      if (!isIncluded(storeEntry.resource.id)) {
        continue;
      }

      const tags = this.normalizeTags(storeEntry.resource.tags);
      if (!this.hasTagId(tags, tag.id)) {
        continue;
      }

      const resourceId = storeEntry.resource.id;
      const resourcesMap = this.resources;
      matches.push({
        definition: storeEntry.resource as TaggedResource<TTag>,
        config: this.readTagConfig(tag, tags),
        get value() {
          const runtimeEntry = resourcesMap.get(resourceId);
          if (!runtimeEntry || !runtimeEntry.isInitialized) {
            return undefined;
          }

          return runtimeEntry.value as TagDependencyResourceMatch<TTag>["value"];
        },
      });
    }

    return matches;
  }

  private collectGenericTaggedMatches<
    TTag extends ITag<any, any, any>,
    TDefinition extends { id: string },
  >(
    tag: TTag,
    definitionIds: ReadonlySet<string> | undefined,
    resolve: (definitionId: string) =>
      | {
          definition: TDefinition;
          tags: TagType[];
        }
      | undefined,
    isIncluded: (definitionId: string) => boolean,
  ): ReadonlyArray<TagDependencyMatch<TDefinition, TTag>> {
    if (!definitionIds || definitionIds.size === 0) {
      return [];
    }

    const matches: Array<TagDependencyMatch<TDefinition, TTag>> = [];
    for (const definitionId of definitionIds) {
      const resolved = resolve(definitionId);
      if (!resolved) {
        continue;
      }
      if (!isIncluded(resolved.definition.id)) {
        continue;
      }
      if (!this.hasTagId(resolved.tags, tag.id)) {
        continue;
      }

      matches.push({
        definition: resolved.definition,
        config: this.readTagConfig(tag, resolved.tags),
      });
    }

    return matches;
  }

  private hasTagId(tags: ReadonlyArray<TagType>, tagId: string): boolean {
    return tags.some((candidate) => candidate.id === tagId);
  }

  private readTagConfig<TTag extends ITag<any, any, any>>(
    tag: TTag,
    tags: TagType[],
  ) {
    return tag.extract(tags);
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

  private reindexDefinitionTags(
    category: IndexedTagCategory,
    definitionId: string,
    tags: ReadonlyArray<TagType>,
  ): void {
    const membershipByDefinition = this.tagMembershipByCategory[category];
    const previousTagIds = membershipByDefinition.get(definitionId);
    if (previousTagIds) {
      for (const tagId of previousTagIds) {
        const bucket = this.tagIndex.get(tagId);
        if (!bucket) {
          continue;
        }

        bucket[category].delete(definitionId);
        if (this.isTagBucketEmpty(bucket)) {
          this.tagIndex.delete(tagId);
        }
      }
    }

    const nextTagIds = new Set<string>();
    for (const tag of tags) {
      nextTagIds.add(tag.id);
    }

    if (nextTagIds.size === 0) {
      membershipByDefinition.delete(definitionId);
      return;
    }

    membershipByDefinition.set(definitionId, nextTagIds);
    for (const tagId of nextTagIds) {
      const bucket = this.getOrCreateTagBucket(tagId);
      bucket[category].add(definitionId);
    }
  }

  private getOrCreateTagBucket(tagId: string): TagIndexBucket {
    const existing = this.tagIndex.get(tagId);
    if (existing) {
      return existing;
    }

    const created = createTagIndexBucket();
    this.tagIndex.set(tagId, created);
    return created;
  }

  private isTagBucketEmpty(bucket: TagIndexBucket): boolean {
    for (const category of indexedTagCategories) {
      if (bucket[category].size > 0) {
        return false;
      }
    }
    return true;
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
