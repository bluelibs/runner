import { createCheckOptionsError } from "./errors";
import { DEFAULT_MATCH_MAX_DEPTH } from "./matcher/shared";
import { getClassSchemaDefinition } from "./classSchema";
import {
  ClassPattern,
  isPlainObject,
  LazyPattern,
  WithErrorPolicyPattern,
  WithMessagePattern,
} from "./matcher";
import type { CheckSchemaLike } from "./types";

export interface CheckOptions {
  errorPolicy?: "first" | "all";
  /** @deprecated Use errorPolicy instead. */
  throwAllErrors?: boolean;
  /**
   * Maximum pattern-matching recursion depth before matching aborts with
   * `checkMaxDepthExceededError`. Defaults to 1000. Use `Infinity` to disable.
   */
  maxDepth?: number;
}

export interface MatchCompileOptions {
  /**
   * Maximum pattern-matching recursion depth before matching aborts with
   * `checkMaxDepthExceededError`. Defaults to 1000. Use `Infinity` to disable.
   */
  maxDepth?: number;
}

export type ResolvedCheckOptions = {
  errorPolicy?: "first" | "all";
  hasExplicitPolicy: boolean;
  maxDepth?: number;
};

const DEFAULT_RESOLVED_OPTIONS: ResolvedCheckOptions = Object.freeze({
  errorPolicy: undefined,
  hasExplicitPolicy: false,
  maxDepth: undefined,
});

export function resolveMaxDepth(maxDepth: unknown): number | undefined {
  if (maxDepth === undefined) {
    return undefined;
  }
  if (maxDepth === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }
  if (
    typeof maxDepth === "number" &&
    Number.isFinite(maxDepth) &&
    maxDepth >= 0
  ) {
    return Math.floor(maxDepth);
  }
  throw createCheckOptionsError(
    'check() option "maxDepth" must be a non-negative number or Infinity when provided.',
  );
}

export function readOptions(options?: CheckOptions): ResolvedCheckOptions {
  if (options === undefined) {
    return DEFAULT_RESOLVED_OPTIONS;
  }
  if (!isPlainObject(options)) {
    throw createCheckOptionsError("check() options must be a plain object.");
  }

  const maxDepth = resolveMaxDepth(
    (options as { maxDepth?: unknown }).maxDepth,
  );

  const errorPolicy = (options as { errorPolicy?: unknown }).errorPolicy;
  if (
    errorPolicy !== undefined &&
    errorPolicy !== "first" &&
    errorPolicy !== "all"
  ) {
    throw createCheckOptionsError(
      'check() option "errorPolicy" must be "first" or "all" when provided.',
    );
  }

  const throwAllErrors = (options as { throwAllErrors?: unknown })
    .throwAllErrors;
  if (throwAllErrors !== undefined && typeof throwAllErrors !== "boolean") {
    throw createCheckOptionsError(
      'check() option "throwAllErrors" must be a boolean when provided.',
    );
  }

  if (errorPolicy !== undefined) {
    return { errorPolicy, hasExplicitPolicy: true, maxDepth };
  }

  if (throwAllErrors !== undefined) {
    return {
      errorPolicy: throwAllErrors ? "all" : "first",
      hasExplicitPolicy: true,
      maxDepth,
    };
  }

  return { errorPolicy: undefined, hasExplicitPolicy: false, maxDepth };
}

export function isCheckSchemaLike(
  value: unknown,
): value is CheckSchemaLike<unknown> {
  if (value === null || typeof value !== "object") return false;

  // All internal Match patterns/tokens carry a `kind` string starting
  // with "Match." — skip them so they go through the normal pattern path.
  if (
    "kind" in value &&
    typeof (value as { kind: unknown }).kind === "string" &&
    (value as { kind: string }).kind.startsWith("Match.")
  ) {
    return false;
  }

  const candidate = value as {
    parse?: unknown;
    toJSONSchema?: unknown;
  };

  if (typeof candidate.parse !== "function") return false;
  if (
    candidate.toJSONSchema !== undefined &&
    typeof candidate.toJSONSchema !== "function"
  ) {
    return false;
  }

  // Keep plain object patterns deterministic unless the intent is explicit.
  if (!isPlainObject(value)) return true;
  const keys = Object.keys(value);
  return keys.every((key) => key === "parse" || key === "toJSONSchema");
}

function resolvePatternDefaultErrorPolicy(
  pattern: unknown,
  depth: number = DEFAULT_MATCH_MAX_DEPTH,
): "first" | "all" | undefined {
  if (pattern instanceof WithErrorPolicyPattern) {
    return pattern.errorPolicy;
  }

  if (pattern instanceof WithMessagePattern) {
    // Depth budget: a chain of fresh WithMessage/Lazy wrappers can recurse
    // without triggering LazyPattern's same-instance cycle guard, so bound the
    // unwrap below the stack ceiling. Exhausted -> treat as "first" and bail.
    if (depth <= 0) return undefined;
    return resolvePatternDefaultErrorPolicy(pattern.pattern, depth - 1);
  }

  if (pattern instanceof LazyPattern) {
    if (depth <= 0) return undefined;
    return resolvePatternDefaultErrorPolicy(pattern.resolve(), depth - 1);
  }

  if (pattern instanceof ClassPattern) {
    if (pattern.options?.errorPolicy !== undefined) {
      return pattern.options.errorPolicy;
    }
    if (pattern.options?.throwAllErrors !== undefined) {
      return pattern.options.throwAllErrors ? "all" : "first";
    }
    return getClassSchemaDefinition(pattern.ctor).errorPolicy;
  }

  return undefined;
}

export function resolveDefaultCollectAll(pattern: unknown): boolean {
  return resolvePatternDefaultErrorPolicy(pattern) === "all";
}
