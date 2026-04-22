import { TagType } from "../../../defs";
import { StoreRegistryDefinitionCloner } from "./StoreRegistryDefinitionCloner";
import type { StoreRegistryAliasResolver } from "./StoreRegistryWriter.types";
import { normalizeTags } from "./types";

export class StoreRegistryTagReferenceNormalizer {
  constructor(
    private readonly aliasResolver: StoreRegistryAliasResolver,
    private readonly definitionCloner: StoreRegistryDefinitionCloner,
  ) {}

  normalizeDefinitionTags(
    tags: ReadonlyArray<{ id: string }> | undefined,
  ): TagType[] {
    return normalizeTags(tags).map((tag) => {
      const resolvedId = this.aliasResolver.resolveDefinitionId(tag);
      if (!resolvedId || resolvedId === tag.id) {
        return tag;
      }

      return this.definitionCloner.cloneWithId(
        tag as TagType & { id: string },
        resolvedId,
      );
    });
  }
}
