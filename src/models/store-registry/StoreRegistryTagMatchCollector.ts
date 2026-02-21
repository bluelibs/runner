import {
  ITag,
  TagType,
  TagDependencyAccessor,
  TagDependencyMatch,
  TagDependencyResourceMatch,
  TagDependencyTaskMatch,
  TaggedResource,
  TaggedTask,
} from "../../defs";
import { normalizeTags, TagIndexedCollections } from "./types";

export class StoreRegistryTagMatchCollector {
  constructor(private readonly collections: TagIndexedCollections) {}

  normalizeTags(tags: unknown): TagType[] {
    return normalizeTags(tags);
  }

  collectTaggedTaskMatches<TTag extends ITag<any, any, any>>(
    tag: TTag,
    definitionIds: ReadonlySet<string> | undefined,
    isIncluded: (definitionId: string) => boolean,
  ): TagDependencyAccessor<TTag>["tasks"] {
    if (!definitionIds || definitionIds.size === 0) {
      return [];
    }

    const matches: TagDependencyTaskMatch<TTag>[] = [];
    for (const definitionId of definitionIds) {
      const storeEntry = this.collections.tasks.get(definitionId);
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

  collectTaggedResourceMatches<TTag extends ITag<any, any, any>>(
    tag: TTag,
    definitionIds: ReadonlySet<string> | undefined,
    isIncluded: (definitionId: string) => boolean,
  ): TagDependencyAccessor<TTag>["resources"] {
    if (!definitionIds || definitionIds.size === 0) {
      return [];
    }

    const matches: TagDependencyResourceMatch<TTag>[] = [];
    for (const definitionId of definitionIds) {
      const storeEntry = this.collections.resources.get(definitionId);
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
      const resourcesMap = this.collections.resources;
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

  collectGenericTaggedMatches<
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
}
