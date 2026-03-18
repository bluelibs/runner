import {
  duplicateTagIdOnDefinitionError,
  tagNotFoundError,
  tagSelfDependencyError,
} from "../../errors";
import { isOptional, isTag, isTagStartup } from "../../define";
import type { ValidatorContext } from "./ValidatorContext";

/**
 * Validates tag constraints:
 * - Tag IDs are unique per definition
 * - All tags used are registered
 * - No self-tag dependencies
 */
export function validateTagConstraints(ctx: ValidatorContext): void {
  validateTagIdsAreUniquePerDefinition(ctx);
  validateAllTagsUsedAreRegistered(ctx);
  validateNoSelfTagDependencies(ctx);
}

function validateTagIdsAreUniquePerDefinition(ctx: ValidatorContext): void {
  ctx.forEachTaggableEntry(({ definitionType, definition }) => {
    const { tags } = definition;
    const seenTagIds = new Set<string>();
    for (const tag of tags) {
      const tagId = ctx.resolveReferenceId(tag)!;
      if (seenTagIds.has(tagId)) {
        duplicateTagIdOnDefinitionError.throw({
          definitionType,
          definitionId: ctx.findIdByDefinition(definition),
          tagId: ctx.findIdByDefinition(tag),
        });
      }
      seenTagIds.add(tagId);
    }
  });
}

function validateAllTagsUsedAreRegistered(ctx: ValidatorContext): void {
  ctx.forEachTaggableEntry(({ definition }) => {
    const { tags } = definition;
    for (const tag of tags) {
      const tagId = ctx.resolveReferenceId(tag)!;
      if (!ctx.registry.tags.has(tagId)) {
        tagNotFoundError.throw({ id: ctx.findIdByDefinition(tag) });
      }
    }
  });
}

function validateNoSelfTagDependencies(ctx: ValidatorContext): void {
  ctx.forEachSelfTagDependencyEntry((entry) => {
    if (!entry.dependencies || typeof entry.dependencies !== "object") {
      return;
    }

    const ownTagIds = new Set(
      entry.tags.map((tag) => ctx.resolveReferenceId(tag)!),
    );

    for (const dependency of Object.values(
      entry.dependencies as Record<string, unknown>,
    )) {
      const maybeDependency = isOptional(dependency)
        ? (dependency as { inner: unknown }).inner
        : dependency;
      const maybeTag = isTagStartup(maybeDependency)
        ? maybeDependency.tag
        : maybeDependency;

      if (!isTag(maybeTag)) {
        continue;
      }

      const dependencyTagId = ctx.resolveReferenceId(maybeTag)!;

      if (!ownTagIds.has(dependencyTagId)) {
        continue;
      }

      tagSelfDependencyError.throw({
        definitionType: entry.definitionType,
        definitionId: ctx.findIdByDefinition(entry.definitionId),
        tagId: ctx.findIdByDefinition(maybeTag),
      });
    }
  });
}
