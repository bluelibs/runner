import {
  AnyResource,
  AnyTask,
  ITag,
  TagDependencyAccessor,
  TaggedResource,
  TaggedTask,
} from "../../defs";
import { VisibilityTracker } from "../VisibilityTracker";
import { TagIndexedCollections } from "./StoreRegistryTagContracts";
import { StoreRegistryTagMatchCollector } from "./StoreRegistryTagMatchCollector";
import { IndexedTagCategory, TagIndexBucket } from "./types";

export class StoreRegistryTagAccessorReader {
  private readonly matchCollector: StoreRegistryTagMatchCollector;

  constructor(
    private readonly collections: TagIndexedCollections,
    private readonly visibilityTracker: VisibilityTracker,
    private readonly tagIndex: Map<string, TagIndexBucket>,
  ) {
    this.matchCollector = new StoreRegistryTagMatchCollector(this.collections);
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
          this.matchCollector.collectGenericTaggedMatches(
            tag,
            bucket?.[IndexedTagCategory.Events],
            (id) => {
              const entry = this.collections.events.get(id);
              if (!entry) {
                return undefined;
              }
              return {
                definition: entry.event,
                tags: this.matchCollector.normalizeTags(entry.event.tags),
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
          this.matchCollector.collectGenericTaggedMatches(
            tag,
            bucket?.[IndexedTagCategory.Hooks],
            (id) => {
              const entry = this.collections.hooks.get(id);
              if (!entry) {
                return undefined;
              }
              return {
                definition: entry.hook,
                tags: this.matchCollector.normalizeTags(entry.hook.tags),
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
            this.matchCollector.collectGenericTaggedMatches(
              tag,
              bucket?.[IndexedTagCategory.TaskMiddlewares],
              (id) => {
                const entry = this.collections.taskMiddlewares.get(id);
                if (!entry) {
                  return undefined;
                }
                return {
                  definition: entry.middleware,
                  tags: this.matchCollector.normalizeTags(
                    entry.middleware.tags,
                  ),
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
            this.matchCollector.collectGenericTaggedMatches(
              tag,
              bucket?.[IndexedTagCategory.ResourceMiddlewares],
              (id) => {
                const entry = this.collections.resourceMiddlewares.get(id);
                if (!entry) {
                  return undefined;
                }
                return {
                  definition: entry.middleware,
                  tags: this.matchCollector.normalizeTags(
                    entry.middleware.tags,
                  ),
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
          this.matchCollector.collectGenericTaggedMatches(
            tag,
            bucket?.[IndexedTagCategory.Errors],
            (id) => {
              const entry = this.collections.errors.get(id);
              if (!entry) {
                return undefined;
              }
              return {
                definition: entry,
                tags: this.matchCollector.normalizeTags(entry.tags),
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

  getTasksWithTag<TTag extends ITag<any, any, any>>(
    tag: TTag,
  ): TaggedTask<TTag>[];
  getTasksWithTag(tag: string): AnyTask[];
  getTasksWithTag(tag: string | ITag<any, any, any>): AnyTask[] {
    if (typeof tag === "string") {
      const found = this.collections.tags.get(tag);
      if (!found) {
        return [];
      }
      return this.getTagAccessor(found).tasks.map((item) => item.definition);
    }

    return this.getTagAccessor(tag).tasks.map((item) => item.definition);
  }

  getResourcesWithTag<TTag extends ITag<any, any, any>>(
    tag: TTag,
  ): TaggedResource<TTag>[];
  getResourcesWithTag(tag: string): AnyResource[];
  getResourcesWithTag(tag: string | ITag<any, any, any>): AnyResource[] {
    if (typeof tag === "string") {
      const found = this.collections.tags.get(tag);
      if (!found) {
        return [];
      }
      return this.getTagAccessor(found).resources.map(
        (item) => item.definition,
      );
    }

    return this.getTagAccessor(tag).resources.map((item) => item.definition);
  }
}
