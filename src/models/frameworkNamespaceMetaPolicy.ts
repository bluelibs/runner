import type {
  ResourceSubtreePolicy,
  SubtreeValidatableElement,
  SubtreeViolation,
} from "../defs";
import {
  isEvent,
  isHook,
  isResource,
  isResourceMiddleware,
  isTag,
  isTask,
  isTaskMiddleware,
} from "../definers/tools";
import { Match } from "../tools/check";

const nonEmptyMetaTextChecker = Match.compile(Match.NonEmptyString);

function getDefinitionLabel(definition: SubtreeValidatableElement): string {
  if (isTask(definition)) {
    return "Task";
  }

  if (isResource(definition)) {
    return "Resource";
  }

  if (isHook(definition)) {
    return "Hook";
  }

  if (isEvent(definition)) {
    return "Event";
  }

  if (isTag(definition)) {
    return "Tag";
  }

  if (isTaskMiddleware(definition)) {
    return "Task middleware";
  }

  if (isResourceMiddleware(definition)) {
    return "Resource middleware";
  }

  return "Definition";
}

function createMetaViolation(
  definition: SubtreeValidatableElement,
  field: "title" | "description",
): SubtreeViolation {
  return {
    code: `framework-meta-${field}-required`,
    message: `${getDefinitionLabel(definition)} "${definition.id}" must define meta.${field}.`,
  };
}

export function validateFrameworkNamespaceMetadata(
  definition: SubtreeValidatableElement,
): SubtreeViolation[] {
  const violations: SubtreeViolation[] = [];
  const title = definition.meta?.title;
  const description = definition.meta?.description;

  if (!nonEmptyMetaTextChecker.test(title) || title.trim().length === 0) {
    violations.push(createMetaViolation(definition, "title"));
  }

  if (
    !nonEmptyMetaTextChecker.test(description) ||
    description.trim().length === 0
  ) {
    violations.push(createMetaViolation(definition, "description"));
  }

  return violations;
}

export const frameworkNamespaceMetaPolicy: ResourceSubtreePolicy =
  Object.freeze({
    validate: [validateFrameworkNamespaceMetadata],
  });
