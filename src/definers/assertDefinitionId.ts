import { validationError } from "../errors";

export const RESERVED_DEFINITION_LOCAL_NAMES = Object.freeze([
  "tasks",
  "events",
  "hooks",
  "resources",
  "tags",
  "errors",
  "asyncContexts",
] as const);

const RESERVED_INTERNAL_DEFINITION_IDS = Object.freeze([
  "runtime-framework-root",
] as const);

const FRAMEWORK_DOTTED_ID_PREFIXES = Object.freeze([
  "runner.",
  "system.",
] as const);

const reservedDefinitionLocalNameSet = new Set<string>(
  RESERVED_DEFINITION_LOCAL_NAMES,
);
const reservedInternalDefinitionIdSet = new Set<string>(
  RESERVED_INTERNAL_DEFINITION_IDS,
);

export function isReservedDefinitionLocalName(name: string): boolean {
  return reservedDefinitionLocalNameSet.has(name);
}

function isReservedInternalDefinitionId(id: string): boolean {
  return reservedInternalDefinitionIdSet.has(id);
}

function canUseFrameworkDottedId(
  definitionId: string,
  allowReservedDottedNamespace: boolean | undefined,
): boolean {
  if (!allowReservedDottedNamespace) {
    return false;
  }

  return FRAMEWORK_DOTTED_ID_PREFIXES.some((prefix) =>
    definitionId.startsWith(prefix),
  );
}

function canUseReservedInternalDefinitionId(
  allowReservedInternalId: boolean | undefined,
): boolean {
  return allowReservedInternalId === true;
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
  options?: {
    allowReservedDottedNamespace?: boolean;
    allowReservedInternalId?: boolean;
  },
): asserts id is string {
  const definitionId = requireStringId(definitionType, id);

  if (definitionId.trim().length === 0) {
    validationError.throw({
      subject: `${definitionType} id`,
      id: toDisplayId(definitionId),
      originalError: `${definitionType} id must be a non-empty string.`,
    });
  }

  if (
    definitionId.includes(".") &&
    !canUseFrameworkDottedId(
      definitionId,
      options?.allowReservedDottedNamespace,
    )
  ) {
    validationError.throw({
      subject: `${definitionType} id`,
      id: definitionId,
      originalError: `${definitionType} id cannot contain ".". Use "-" instead.`,
    });
  }

  if (isReservedDefinitionLocalName(definitionId)) {
    validationError.throw({
      subject: `${definitionType} id`,
      id: definitionId,
      originalError: `${definitionType} id "${definitionId}" is reserved by Runner and cannot be used as a standalone id.`,
    });
  }

  if (
    isReservedInternalDefinitionId(definitionId) &&
    !canUseReservedInternalDefinitionId(options?.allowReservedInternalId)
  ) {
    validationError.throw({
      subject: `${definitionType} id`,
      id: definitionId,
      originalError: `${definitionType} id "${definitionId}" is reserved for internal Runner resources.`,
    });
  }
}
