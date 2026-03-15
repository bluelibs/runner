import { validationError } from "../errors";

function throwDefinitionValidationError(args: {
  subject: string;
  id: string;
  originalError: string;
}): never {
  return validationError.throw(args);
}

export const RESERVED_DEFINITION_LOCAL_NAMES = Object.freeze([
  "tasks",
  "events",
  "hooks",
  "resources",
  "tags",
  "errors",
  "asyncContexts",
] as const);

const reservedDefinitionLocalNameSet = new Set<string>(
  RESERVED_DEFINITION_LOCAL_NAMES,
);

export function isReservedDefinitionLocalName(name: string): boolean {
  return reservedDefinitionLocalNameSet.has(name);
}

function toDisplayId(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 0 ? value : "<empty>";
  }

  return String(value);
}

function requireStringId(definitionType: string, id: unknown): string {
  if (typeof id !== "string") {
    throwDefinitionValidationError({
      subject: `${definitionType} id`,
      id: toDisplayId(id),
      originalError: `${definitionType} id must be a non-empty string.`,
    });
  }

  return id as string;
}

export function assertDefinitionId(
  definitionType: string,
  id: unknown,
): asserts id is string {
  const definitionId = requireStringId(definitionType, id);

  if (definitionId.trim().length === 0) {
    throwDefinitionValidationError({
      subject: `${definitionType} id`,
      id: toDisplayId(definitionId),
      originalError: `${definitionType} id must be a non-empty string.`,
    });
  }

  if (definitionId.includes(".")) {
    throwDefinitionValidationError({
      subject: `${definitionType} id`,
      id: definitionId,
      originalError: `${definitionType} id cannot contain ".". Use "-" instead.`,
    });
  }

  if (isReservedDefinitionLocalName(definitionId)) {
    throwDefinitionValidationError({
      subject: `${definitionType} id`,
      id: definitionId,
      originalError: `${definitionType} id "${definitionId}" is reserved by Runner and cannot be used as a standalone id.`,
    });
  }
}
