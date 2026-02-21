import {
  AnyResource,
  AnyTask,
  ITag,
  TagDependencyAccessor,
  TaggedResource,
  TaggedTask,
  TagType,
} from "../../defs";
import { VisibilityTracker } from "../VisibilityTracker";
import { StoreRegistryTagAccessorReader } from "./StoreRegistryTagAccessorReader";
import { TagIndexedCollections } from "./StoreRegistryTagContracts";
import {
  createTagIndexBucket,
  IndexedTagCategory,
  indexedTagCategories,
  TagIndexBucket,
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
  private readonly accessorReader: StoreRegistryTagAccessorReader;

  constructor(
    private readonly collections: TagIndexedCollections,
    private readonly visibilityTracker: VisibilityTracker,
  ) {
    this.accessorReader = new StoreRegistryTagAccessorReader(
      this.collections,
      this.visibilityTracker,
      this.tagIndex,
    );
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

  getTagAccessor<TTag extends ITag<any, any, any>>(
    tag: TTag,
    options?: { consumerId?: string; includeSelf?: boolean },
  ): TagDependencyAccessor<TTag> {
    return this.accessorReader.getTagAccessor(tag, options);
  }

  getTasksWithTag<TTag extends ITag<any, any, any>>(
    tag: TTag,
  ): TaggedTask<TTag>[];
  getTasksWithTag(tag: string): AnyTask[];
  getTasksWithTag(tag: string | ITag<any, any, any>): AnyTask[] {
    return typeof tag === "string"
      ? this.accessorReader.getTasksWithTag(tag)
      : this.accessorReader.getTasksWithTag(tag);
  }

  getResourcesWithTag<TTag extends ITag<any, any, any>>(
    tag: TTag,
  ): TaggedResource<TTag>[];
  getResourcesWithTag(tag: string): AnyResource[];
  getResourcesWithTag(tag: string | ITag<any, any, any>): AnyResource[] {
    return typeof tag === "string"
      ? this.accessorReader.getResourcesWithTag(tag)
      : this.accessorReader.getResourcesWithTag(tag);
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
