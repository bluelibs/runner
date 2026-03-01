import { CheckJsonSchemaPatternError } from "./errors";

export type CompileContext = {
  activePatterns: WeakSet<object>;
  strict: boolean;
};

export type CompileMode = "default" | "object-property";

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}

export function appendKey(path: string, key: string): string {
  if (isIdentifier(key)) return `${path}.${key}`;
  return `${path}[${JSON.stringify(key)}]`;
}

export function appendIndex(path: string, index: number): string {
  return `${path}[${index}]`;
}

function describePatternKind(pattern: unknown): string {
  const tokenKind = (pattern as { kind?: unknown } | null)?.kind;
  if (typeof tokenKind === "string") {
    const suffix = "Pattern";
    return tokenKind.endsWith(suffix)
      ? tokenKind.slice(0, -suffix.length)
      : tokenKind;
  }
  if (Array.isArray(pattern)) return "ArrayPattern";
  if (isPlainObject(pattern)) return "ObjectPattern";
  if (pattern === String || pattern === Number || pattern === Boolean) {
    return (
      pattern as StringConstructor | NumberConstructor | BooleanConstructor
    ).name;
  }
  if (pattern === Object || pattern === Array || pattern === Function) {
    return (
      pattern as ObjectConstructor | ArrayConstructor | FunctionConstructor
    ).name;
  }
  if (pattern === undefined) return "undefined literal";
  if (pattern === null) return "null literal";

  const valueType = typeof pattern;
  if (
    valueType === "string" ||
    valueType === "number" ||
    valueType === "boolean"
  ) {
    return `${valueType} literal`;
  }
  if (valueType === "bigint" || valueType === "symbol") {
    return `${valueType} literal`;
  }
  if (valueType === "function") return "constructor/function pattern";
  return valueType;
}

export function throwUnsupported(
  path: string,
  reason: string,
  pattern: unknown,
): never {
  throw new CheckJsonSchemaPatternError(
    path,
    reason,
    describePatternKind(pattern),
  );
}

export function withCycleGuard<T>(
  pattern: object,
  context: CompileContext,
  path: string,
  execute: () => T,
): T {
  if (context.activePatterns.has(pattern)) {
    throwUnsupported(path, "Circular pattern reference detected.", pattern);
  }
  context.activePatterns.add(pattern);
  try {
    return execute();
  } finally {
    context.activePatterns.delete(pattern);
  }
}
