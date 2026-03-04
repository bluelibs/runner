import { validationError } from "../errors";

export const RESERVED_DEFINITION_LOCAL_NAMES = Object.freeze([
  "tasks",
  "events",
  "hooks",
  "resources",
  "tags",
  "errors",
  "ctx",
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
    validationError.throw({
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
    validationError.throw({
      subject: `${definitionType} id`,
      id: toDisplayId(definitionId),
      originalError: `${definitionType} id must be a non-empty string.`,
    });
  }

  if (definitionId.startsWith(".") || definitionId.endsWith(".")) {
    validationError.throw({
      subject: `${definitionType} id`,
      id: definitionId,
      originalError: `${definitionType} id cannot start or end with ".".`,
    });
  }

  if (definitionId.includes("..")) {
    validationError.throw({
      subject: `${definitionType} id`,
      id: definitionId,
      originalError: `${definitionType} id cannot contain empty dot-separated segments ("..").`,
    });
  }

  if (isReservedDefinitionLocalName(definitionId)) {
    validationError.throw({
      subject: `${definitionType} id`,
      id: definitionId,
      originalError: `${definitionType} id "${definitionId}" is reserved by Runner and cannot be used as a standalone id.`,
    });
  }
}
