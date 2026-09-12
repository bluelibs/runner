import type { TagTarget } from "../defs";

export const RESERVED_DEFINITION_LOCAL_NAMES = Object.freeze([
  "tasks",
  "events",
  "hooks",
  "resources",
  "tags",
  "errors",
  "asyncContexts",
] as const);

export type DefinitionIdViolation = {
  subject: string;
  id: string;
  originalError: string;
};

export type TagTargetViolation = {
  definitionType: string;
  definitionId: string;
  tagId: string;
  attemptedTarget: string;
  allowedTargets: string[];
};

export function isReservedDefinitionLocalName(name: string): boolean {
  return (
    name === "tasks" ||
    name === "events" ||
    name === "hooks" ||
    name === "resources" ||
    name === "tags" ||
    name === "errors" ||
    name === "asyncContexts"
  );
}

function toDisplayId(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 0 ? value : "<empty>";
  }
  return String(value);
}

export function getDefinitionIdViolation(
  definitionType: string,
  id: unknown,
): DefinitionIdViolation | undefined {
  if (typeof id !== "string" || id.trim().length === 0) {
    return {
      subject: `${definitionType} id`,
      id: toDisplayId(id),
      originalError: `${definitionType} id must be a non-empty string.`,
    };
  }
  if (id.includes(".")) {
    return {
      subject: `${definitionType} id`,
      id,
      originalError: `${definitionType} id cannot contain ".". Use "-" instead.`,
    };
  }
  if (isReservedDefinitionLocalName(id)) {
    return {
      subject: `${definitionType} id`,
      id,
      originalError: `${definitionType} id "${id}" is reserved by Runner and cannot be used as a standalone id.`,
    };
  }
  return undefined;
}

type TagLikeWithTargets = {
  id?: unknown;
  targets?: unknown;
};

export function getTagTargetViolation(
  definitionType: string,
  definitionId: string,
  target: TagTarget,
  tags: unknown,
): TagTargetViolation | undefined {
  if (!Array.isArray(tags) || tags.length === 0) {
    return undefined;
  }

  for (const candidate of tags) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const tag: TagLikeWithTargets = candidate;
    if (tag.targets === undefined) {
      continue;
    }
    const allowedTargets = Array.isArray(tag.targets)
      ? tag.targets.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    if (!allowedTargets.includes(target)) {
      return {
        definitionType,
        definitionId,
        tagId: typeof tag.id === "string" ? tag.id : "<unknown-tag>",
        attemptedTarget: target,
        allowedTargets,
      };
    }
  }
  return undefined;
}
