import type { TagTarget, TagType } from "../defs";
import { tagTargetNotAllowedError } from "../errors";
import { getTagTargetViolation } from "./definitionValidation";

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
  const violation = getTagTargetViolation(
    definitionType,
    definitionId,
    target,
    tags,
  );
  if (violation) {
    tagTargetNotAllowedError.throw(violation);
  }
}

export function assertTagTargetsApplicableTo(
  target: TagTarget,
  definitionType: string,
  definitionId: string,
  tags: TagType[] | undefined,
): void {
  assertTagTargetsApplicable({
    target,
    definitionType,
    definitionId,
    tags,
  });
}
