import {
  AnyResource,
  AnyTask,
  ITag,
  TagDependencyAccessor,
  TagDependencyMatch,
  TaggedResource,
  TaggedTask,
  TagType,
} from "../../defs";
import { VisibilityTracker } from "../VisibilityTracker";
import { StoreRegistryTagMatchCollector } from "./StoreRegistryTagMatchCollector";
import {
  createTagIndexBucket,
  IndexedTagCategory,
  indexedTagCategories,
  normalizeTags,
  TagIndexBucket,
  TagIndexedCollections,
} from "./types";

type TagMembershipByCategory = Record<
  IndexedTagCategory,
  Map<string, Set<string>>
>;

const createTagMembershipByCategory = (): TagMembershipByCategory => ({
  [IndexedTagCategory.Tasks]: new Map<string, Set<string>>(),
  [IndexedTagCategory.Resources]: new Map<string, Set<string>>(),
  [IndexedTagCategory.Events]: new Map<string, Set<string>>(),
  [IndexedTagCategory.Hooks]: new Map<string, Set<string>>(),
  [IndexedTagCategory.TaskMiddlewares]: new Map<string, Set<string>>(),
  [IndexedTagCategory.ResourceMiddlewares]: new Map<string, Set<string>>(),
  [IndexedTagCategory.Errors]: new Map<string, Set<string>>(),
});

export class StoreRegistryTagIndex {
  private readonly tagIndex = new Map<string, TagIndexBucket>();
  private readonly tagMembershipByCategory = createTagMembershipByCategory();
  private readonly matchCollector: StoreRegistryTagMatchCollector;

  constructor(
    private readonly collections: TagIndexedCollections,
    private readonly visibilityTracker: VisibilityTracker,
  ) {
    this.matchCollector = new StoreRegistryTagMatchCollector(this.collections);
  }

  get index(): Map<string, TagIndexBucket> {
    return this.tagIndex;
  }

  reindexDefinitionTags(
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

  // ---------------------------------------------------------------------------
  // Tag accessor — builds a lazy, cached, visibility-filtered accessor
  // ---------------------------------------------------------------------------

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
          this.matchCollector.collectTaggedTaskMatches(
            tag,
            bucket?.[IndexedTagCategory.Tasks],
            isIncluded,
          ),
        );
      }
      return tasksCache;
    };

    const readResources = (): TagDependencyAccessor<TTag>["resources"] => {
      if (!resourcesCache) {
        resourcesCache = Object.freeze(
          this.matchCollector.collectTaggedResourceMatches(
            tag,
            bucket?.[IndexedTagCategory.Resources],
            isIncluded,
          ),
        );
      }
      return resourcesCache;
    };

    const readEvents = (): TagDependencyAccessor<TTag>["events"] => {
      if (!eventsCache) {
        eventsCache = Object.freeze(
          this.collectGenericFromBucket<TTag>(
            tag,
            bucket,
            IndexedTagCategory.Events,
            (id) => {
              const entry = this.collections.events.get(id);
              if (!entry) return undefined;
              return {
                definition: entry.event,
                tags: normalizeTags(entry.event.tags),
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
          this.collectGenericFromBucket<TTag>(
            tag,
            bucket,
            IndexedTagCategory.Hooks,
            (id) => {
              const entry = this.collections.hooks.get(id);
              if (!entry) return undefined;
              return {
                definition: entry.hook,
                tags: normalizeTags(entry.hook.tags),
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
            this.collectGenericFromBucket<TTag>(
              tag,
              bucket,
              IndexedTagCategory.TaskMiddlewares,
              (id) => {
                const entry = this.collections.taskMiddlewares.get(id);
                if (!entry) return undefined;
                return {
                  definition: entry.middleware,
                  tags: normalizeTags(entry.middleware.tags),
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
            this.collectGenericFromBucket<TTag>(
              tag,
              bucket,
              IndexedTagCategory.ResourceMiddlewares,
              (id) => {
                const entry = this.collections.resourceMiddlewares.get(id);
                if (!entry) return undefined;
                return {
                  definition: entry.middleware,
                  tags: normalizeTags(entry.middleware.tags),
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
          this.collectGenericFromBucket<TTag>(
            tag,
            bucket,
            IndexedTagCategory.Errors,
            (id) => {
              const entry = this.collections.errors.get(id);
              if (!entry) return undefined;
              return { definition: entry, tags: normalizeTags(entry.tags) };
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
  getTasksWithTag(tag: string): AnyTask[];
  getTasksWithTag(tag: string | ITag<any, any, any>): AnyTask[] {
    const resolved =
      typeof tag === "string" ? this.collections.tags.get(tag) : tag;
    if (!resolved) return [];
    return this.getTagAccessor(resolved).tasks.map((item) => item.definition);
  }

  /**
   * @deprecated Use tag dependencies (`dependencies({ myTag })`) and the injected accessor.
   */
  getResourcesWithTag<TTag extends ITag<any, any, any>>(
    tag: TTag,
  ): TaggedResource<TTag>[];
  getResourcesWithTag(tag: string): AnyResource[];
  getResourcesWithTag(tag: string | ITag<any, any, any>): AnyResource[] {
    const resolved =
      typeof tag === "string" ? this.collections.tags.get(tag) : tag;
    if (!resolved) return [];
    return this.getTagAccessor(resolved).resources.map(
      (item) => item.definition,
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Delegates to the match collector's generic matching for non-task/resource
   * categories (events, hooks, middlewares, errors).
   */
  private collectGenericFromBucket<TTag extends ITag<any, any, any>>(
    tag: TTag,
    bucket: TagIndexBucket | undefined,
    category: IndexedTagCategory,
    resolve: (
      definitionId: string,
    ) => { definition: { id: string }; tags: TagType[] } | undefined,
    isIncluded: (definitionId: string) => boolean,
  ): ReadonlyArray<TagDependencyMatch<any, TTag>> {
    return this.matchCollector.collectGenericTaggedMatches(
      tag,
      bucket?.[category],
      resolve,
      isIncluded,
    );
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
}
