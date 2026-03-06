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

const FRAMEWORK_DOTTED_ID_PREFIXES = Object.freeze([
  "runner.",
  "system.",
] as const);

const reservedDefinitionLocalNameSet = new Set<string>(
  RESERVED_DEFINITION_LOCAL_NAMES,
);

export function isReservedDefinitionLocalName(name: string): boolean {
  return reservedDefinitionLocalNameSet.has(name);
}

function isFrameworkOwnedCallerFile(
  callerFilePath: string | undefined,
): boolean {
  if (!callerFilePath) {
    return false;
  }

  const packageRoot = normalizeFilePath(`${__dirname}/../..`);
  const normalizedCallerPath = normalizeFilePath(callerFilePath);
  const relativeCallerPath = getRelativePackagePath(
    packageRoot,
    normalizedCallerPath,
  );

  if (!relativeCallerPath) {
    return false;
  }

  if (
    relativeCallerPath.startsWith("__tests__/") ||
    relativeCallerPath.includes("/__tests__/")
  ) {
    return false;
  }

  return (
    relativeCallerPath.startsWith("src/") ||
    relativeCallerPath.startsWith("dist/")
  );
}

function normalizeFilePath(filePath: string): string {
  const normalizedSeparators = filePath.replace(/\\/g, "/");
  const isAbsolute = normalizedSeparators.startsWith("/");
  const parts = normalizedSeparators.split("/");
  const normalizedParts: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      const lastPart = normalizedParts[normalizedParts.length - 1];
      if (lastPart && lastPart !== ".." && !lastPart.endsWith(":")) {
        normalizedParts.pop();
        continue;
      }
    }

    normalizedParts.push(part);
  }

  const normalizedPath = normalizedParts.join("/");
  return isAbsolute ? `/${normalizedPath}` : normalizedPath;
}

function getRelativePackagePath(
  packageRoot: string,
  callerFilePath: string,
): string | null {
  if (callerFilePath === packageRoot) {
    return "";
  }

  const packageRootPrefix = `${packageRoot}/`;
  if (!callerFilePath.startsWith(packageRootPrefix)) {
    return null;
  }

  return callerFilePath.slice(packageRootPrefix.length);
}

function canUseFrameworkDottedId(
  definitionId: string,
  callerFilePath: string | undefined,
): boolean {
  if (!isFrameworkOwnedCallerFile(callerFilePath)) {
    return false;
  }

  return FRAMEWORK_DOTTED_ID_PREFIXES.some((prefix) =>
    definitionId.startsWith(prefix),
  );
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
  options?: { callerFilePath?: string },
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
    !canUseFrameworkDottedId(definitionId, options?.callerFilePath)
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
}
