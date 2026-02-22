import type { TagTarget, TagType } from "../defs";
import { tagTargetNotAllowedError } from "../errors";

type TagLikeWithTargets = {
  id?: unknown;
  targets?: unknown;
};

export interface AssertTagTargetsApplicableInput {
  definitionType: string;
  definitionId: string;
  target: TagTarget;
  tags: unknown;
}

export function assertTagTargetsApplicable({
  definitionType,
  definitionId,
  target,
  tags,
}: AssertTagTargetsApplicableInput): void {
  if (!Array.isArray(tags) || tags.length === 0) {
    return;
  }

  for (const candidate of tags) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const tag = candidate as TagLikeWithTargets;
    if (tag.targets === undefined) {
      continue;
    }

    const allowedTargets = Array.isArray(tag.targets)
      ? tag.targets.filter(
          (value): value is string => typeof value === "string",
        )
      : [];

    if (allowedTargets.includes(target)) {
      continue;
    }

    tagTargetNotAllowedError.throw({
      definitionType,
      definitionId,
      tagId: typeof tag.id === "string" ? tag.id : "<unknown-tag>",
      attemptedTarget: target,
      allowedTargets,
    });
  }
}

export const assertTagTargetsApplicableTo = (
  target: TagTarget,
  definitionType: string,
  definitionId: string,
  tags: TagType[] | undefined,
): void =>
  assertTagTargetsApplicable({
    target,
    definitionType,
    definitionId,
    tags,
  });
