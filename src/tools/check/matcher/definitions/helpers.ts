import { createMatchError, createMatchPatternError } from "../../errors";
import type {
  MatchJsonSchema,
  MatchMessageContext,
  MatchMessageDescriptor,
  MatchMessageOptions,
  MatchPattern,
} from "../../types";
import type { CompileContext } from "../../toJsonSchema.helpers";
import { appendKey } from "../../toJsonSchema.helpers";
import {
  isOptionalObjectPropertyPattern,
  shouldPatternApplyMessageOverrideToAggregate,
  type MatchJsonSchemaCompiler,
} from "../contracts";
import type { MatchContext } from "../shared";

export type PatternHolder = { pattern?: unknown };
export type WithMessageHolder = {
  pattern: MatchPattern;
  message: MatchMessageOptions;
};
export type WithErrorPolicyHolder = { pattern: unknown };
export type LazyHolder = { resolve?: unknown };
export type ClassHolder = { ctor?: unknown; options?: unknown };
export type RegExpHolder = { expression?: unknown };
export type MatchClassPatternOptions = {
  exact?: boolean;
  schemaId?: string;
};

function normalizeMatchMessageValue(
  value: string | MatchMessageDescriptor,
): MatchMessageDescriptor {
  return typeof value === "string" ? { message: value } : value;
}

function isMatchMessageDescriptor(
  value: unknown,
): value is MatchMessageDescriptor {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const typedValue = value as {
    message?: unknown;
    code?: unknown;
    params?: unknown;
  };

  if (typeof typedValue.message !== "string") {
    return false;
  }

  if (typedValue.code !== undefined && typeof typedValue.code !== "string") {
    return false;
  }

  if (
    typedValue.params !== undefined &&
    (!typedValue.params ||
      typeof typedValue.params !== "object" ||
      Array.isArray(typedValue.params))
  ) {
    return false;
  }

  return true;
}

function applyMatchMessageOverride(
  context: MatchContext,
  nestedFailures: Array<{ code?: string; params?: Record<string, unknown> }>,
  resolvedMessage: MatchMessageDescriptor,
  appliesToAggregate: boolean,
): void {
  context.messageOverride = {
    message: resolvedMessage.message,
    appliesToAggregate,
  };

  for (const failure of nestedFailures) {
    if (failure.code === undefined && resolvedMessage.code !== undefined) {
      failure.code = resolvedMessage.code;
    }

    if (failure.params === undefined && resolvedMessage.params !== undefined) {
      failure.params = resolvedMessage.params;
    }
  }
}

export function maybeApplyPatternMessageOverride(
  pattern: WithMessageHolder,
  value: unknown,
  parent: unknown,
  context: MatchContext,
  failuresBefore: number,
): void {
  const firstNewFailure = context.failures[failuresBefore];
  const firstFailure = context.failures[0];
  if (failuresBefore > 0 && firstNewFailure !== firstFailure) {
    return;
  }

  const messageOption = pattern.message;
  const appliesToAggregate = shouldPatternApplyMessageOverrideToAggregate(
    pattern.pattern,
  );
  if (typeof messageOption !== "function") {
    applyMatchMessageOverride(
      context,
      context.failures.slice(failuresBefore),
      normalizeMatchMessageValue(messageOption),
      appliesToAggregate,
    );
    return;
  }

  const nestedFailures = context.failures.slice(failuresBefore);
  const nestedError = createMatchError(nestedFailures);
  const errorContext: MatchMessageContext = {
    value,
    parent,
    error: nestedError,
    path: nestedError.data.path,
    pattern: pattern.pattern,
  };

  let resolvedMessage: unknown;
  try {
    resolvedMessage = messageOption(errorContext);
  } catch (error) {
    throw createMatchPatternError(
      `Bad pattern: Match.WithMessage formatter threw: ${String(error)}`,
    );
  }

  if (
    typeof resolvedMessage !== "string" &&
    !isMatchMessageDescriptor(resolvedMessage)
  ) {
    throw createMatchPatternError(
      "Bad pattern: Match.WithMessage formatter must return a string or plain object.",
    );
  }

  applyMatchMessageOverride(
    context,
    nestedFailures,
    normalizeMatchMessageValue(resolvedMessage),
    appliesToAggregate,
  );
}

function sanitizeDefinitionId(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$]/g, "_");
  return cleaned.length > 0 ? cleaned : "Anonymous";
}

export function isResolver(value: unknown): value is () => unknown {
  return typeof value === "function";
}

export function isWhereCondition(
  value: unknown,
): value is (value: unknown, parent: unknown) => boolean {
  return typeof value === "function";
}

export function isMatchClassPatternOptions(
  value: unknown,
): value is MatchClassPatternOptions {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (candidate.exact !== undefined && typeof candidate.exact !== "boolean") {
    return false;
  }
  if (
    candidate.schemaId !== undefined &&
    typeof candidate.schemaId !== "string"
  ) {
    return false;
  }

  return true;
}

export function getDefinitionId(
  context: CompileContext,
  ctor: abstract new (...args: never[]) => unknown,
  preferredId: string,
): string {
  const existing = context.classDefinitionIds.get(ctor as unknown as Function);
  if (existing) return existing;

  const baseId = sanitizeDefinitionId(preferredId);
  let candidateId = baseId;

  while (context.definitions[candidateId]) {
    context.definitionCounter += 1;
    candidateId = `${baseId}_${context.definitionCounter}`;
  }

  context.classDefinitionIds.set(ctor as unknown as Function, candidateId);
  return candidateId;
}

export function compileObjectPattern(
  pattern: Record<string, unknown>,
  context: CompileContext,
  path: string,
  allowUnknownKeys: boolean,
  compilePattern: MatchJsonSchemaCompiler,
): MatchJsonSchema {
  const properties: Record<string, MatchJsonSchema> = {};
  const required: string[] = [];

  for (const [key, childPattern] of Object.entries(pattern)) {
    const childPath = appendKey(path, key);
    properties[key] = compilePattern(
      childPattern,
      context,
      childPath,
      "object-property",
    );
    if (!isOptionalObjectPropertyPattern(childPattern)) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: allowUnknownKeys,
  };
}
