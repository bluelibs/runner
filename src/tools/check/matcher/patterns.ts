import { MatchPatternError } from "../errors";
import { matchToJsonSchema } from "../toJsonSchema";
import type {
  MatchJsonSchema,
  MatchMessageOptions,
  MatchToJsonSchemaOptions,
} from "../types";
import type { NonEmptyArrayElement, WhereCondition } from "./shared";
import { parsePatternValue } from "./parse";

// ── Base class: provides parse() + toJSONSchema() for all pattern classes ────

export class MatchPatternBase<TParseResult = unknown> {
  parse(value: unknown): TParseResult {
    return parsePatternValue(value, this) as TParseResult;
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this, options);
  }
}

// ── Pattern classes ──────────────────────────────────────────────────────────

export class MaybePattern<TPattern = unknown> extends MatchPatternBase<
  TParseResult.Maybe<TPattern>
> {
  public readonly kind = "Match.MaybePattern";
  constructor(public readonly pattern: TPattern) {
    super();
  }
}

export class OptionalPattern<TPattern = unknown> extends MatchPatternBase<
  TParseResult.Optional<TPattern>
> {
  public readonly kind = "Match.OptionalPattern";
  constructor(public readonly pattern: TPattern) {
    super();
  }
}

export class OneOfPattern<
  TPatterns extends readonly unknown[] = readonly [],
> extends MatchPatternBase<TParseResult.OneOf<TPatterns>> {
  public readonly kind = "Match.OneOfPattern";
  constructor(public readonly patterns: TPatterns) {
    super();
  }
}

export class WherePattern<
  TGuarded = unknown,
> extends MatchPatternBase<TGuarded> {
  public readonly kind = "Match.WherePattern";
  constructor(public readonly condition: WhereCondition<TGuarded>) {
    super();
  }
}

export class WithMessagePattern<TPattern = unknown> extends MatchPatternBase<
  TParseResult.WithMessage<TPattern>
> {
  public readonly kind = "Match.WithMessagePattern";
  constructor(
    public readonly pattern: TPattern,
    public readonly options: MatchMessageOptions,
  ) {
    super();
  }
}

export class WithErrorPolicyPattern<
  TPattern = unknown,
> extends MatchPatternBase<TParseResult.WithErrorPolicy<TPattern>> {
  public readonly kind = "Match.WithErrorPolicyPattern";
  constructor(
    public readonly pattern: TPattern,
    public readonly errorPolicy: "first" | "all",
  ) {
    super();
  }
}

export class LazyPattern<TPattern = unknown> extends MatchPatternBase<
  TParseResult.Lazy<TPattern>
> {
  public readonly kind = "Match.LazyPattern";

  private hasResolved = false;
  private resolvedPattern?: TPattern;
  private isResolving = false;

  constructor(private readonly resolver: () => TPattern) {
    super();
  }

  resolve(): TPattern {
    if (this.hasResolved) return this.resolvedPattern as TPattern;
    if (this.isResolving) {
      throw new MatchPatternError(
        "Bad pattern: Match.Lazy resolver produced a circular unresolved reference.",
      );
    }

    this.isResolving = true;
    try {
      const resolved = this.resolver();
      if (resolved === undefined) {
        throw new MatchPatternError(
          "Bad pattern: Match.Lazy resolver must return a pattern.",
        );
      }
      // Resolving to itself would otherwise loop forever at match time.
      if ((resolved as unknown) === (this as unknown)) {
        throw new MatchPatternError(
          "Bad pattern: Match.Lazy resolver cannot resolve to itself.",
        );
      }

      this.resolvedPattern = resolved;
      this.hasResolved = true;
      return resolved;
    } finally {
      this.isResolving = false;
    }
  }
}

export class ClassPattern<
  TCtor extends abstract new (...args: never[]) => unknown,
> extends MatchPatternBase<InstanceType<TCtor>> {
  public readonly kind = "Match.ClassPattern";

  constructor(
    public readonly ctor: TCtor,
    public readonly options?: {
      exact?: boolean;
      schemaId?: string;
      errorPolicy?: "first" | "all";
      throwAllErrors?: boolean;
    },
  ) {
    super();
  }
}

export class RegExpPattern<
  TExpression extends RegExp = RegExp,
> extends MatchPatternBase<string> {
  public readonly kind = "Match.RegExpPattern";
  public readonly expression: TExpression;

  constructor(expression: TExpression) {
    super();
    this.expression = new RegExp(
      expression.source,
      expression.flags,
    ) as TExpression;
  }
}

export class ObjectIncludingPattern<
  TObjectPattern extends Record<string, unknown> = Record<string, unknown>,
> extends MatchPatternBase<TParseResult.ObjectIncluding<TObjectPattern>> {
  public readonly kind = "Match.ObjectIncludingPattern";
  constructor(public readonly pattern: TObjectPattern) {
    super();
  }
}

export class ObjectStrictPattern<
  TObjectPattern extends Record<string, unknown> = Record<string, unknown>,
> extends MatchPatternBase<TParseResult.ObjectStrict<TObjectPattern>> {
  public readonly kind = "Match.ObjectStrictPattern";
  constructor(public readonly pattern: TObjectPattern) {
    super();
  }
}

export class MapOfPattern<TPattern = unknown> extends MatchPatternBase<
  TParseResult.MapOf<TPattern>
> {
  public readonly kind = "Match.MapOfPattern";
  constructor(public readonly pattern: TPattern) {
    super();
  }
}

export class NonEmptyArrayPattern<
  TPattern = undefined,
> extends MatchPatternBase<TParseResult.NonEmptyArray<TPattern>> {
  public readonly kind = "Match.NonEmptyArrayPattern";
  constructor(public readonly pattern?: TPattern) {
    super();
  }
}

// ── Namespace for parse result types ─────────────────────────────────────────
// Keeps the generic extends clauses on each class readable.

import type { InferMatchPattern } from "../types";

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace TParseResult {
  export type Maybe<T> = InferMatchPattern<T> | null | undefined;
  export type Optional<T> = InferMatchPattern<T> | undefined;
  export type OneOf<T extends readonly unknown[]> = InferMatchPattern<
    T[number]
  >;
  export type WithMessage<T> = InferMatchPattern<T>;
  export type WithErrorPolicy<T> = InferMatchPattern<T>;
  export type Lazy<T> = InferMatchPattern<T>;
  export type ObjectIncluding<T extends Record<string, unknown>> =
    InferMatchPattern<T> & Record<string, unknown>;
  export type ObjectStrict<T extends Record<string, unknown>> =
    InferMatchPattern<T>;
  export type MapOf<T> = Record<string, InferMatchPattern<T>>;
  export type NonEmptyArray<T> = [
    NonEmptyArrayElement<T>,
    ...NonEmptyArrayElement<T>[],
  ];
}
