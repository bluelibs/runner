import { createMatchPatternError } from "../errors";
import { matchToJsonSchema } from "../toJsonSchema";
import type {
  MatchJsonSchema,
  MatchMessageOptions,
  MatchToJsonSchemaOptions,
} from "../types";
import type {
  MatchJsonSchemaCompiler,
  MatchPatternDefinition,
  MatchPatternMatcher,
} from "./contracts";
import { collectMatchFailures } from "./core";
import type { NonEmptyArrayElement, WhereCondition } from "./shared";
import { parsePatternValue } from "./parse";
import {
  classPatternDefinition,
  lazyPatternDefinition,
  mapOfPatternDefinition,
  maybePatternDefinition,
  nonEmptyArrayPatternDefinition,
  objectIncludingPatternDefinition,
  objectStrictPatternDefinition,
  oneOfPatternDefinition,
  optionalPatternDefinition,
  regExpPatternDefinition,
  wherePatternDefinition,
  withErrorPolicyPatternDefinition,
  withMessagePatternDefinition,
} from "./patternDefinitions";

// ── Base class: provides parse() + toJSONSchema() for all pattern classes ────

const patternDefinitionByInstance = new WeakMap<
  object,
  MatchPatternDefinition<object>
>();

export class MatchPatternBase<
  TParseResult = unknown,
  TSelf extends object = object,
> {
  constructor(definition: MatchPatternDefinition<TSelf>) {
    // We store definitions out-of-band so pattern instances stay structurally
    // simple for TypeScript inference, especially around optional-property
    // wrappers used inside object patterns.
    patternDefinitionByInstance.set(
      this,
      definition as MatchPatternDefinition<object>,
    );
  }

  private getDefinition(): MatchPatternDefinition<TSelf> {
    const definition = patternDefinitionByInstance.get(this);
    if (!definition) {
      throw createMatchPatternError("Bad pattern: missing Match definition.");
    }

    return definition as MatchPatternDefinition<TSelf>;
  }

  parse(value: unknown): TParseResult {
    return parsePatternValue(value, this) as TParseResult;
  }

  test(value: unknown): value is TParseResult {
    return collectMatchFailures(value, this, false).length === 0;
  }

  match(
    value: unknown,
    context: Parameters<MatchPatternMatcher>[2],
    path: Parameters<MatchPatternMatcher>[3],
    parent: unknown,
    matchesPattern: MatchPatternMatcher,
  ): value is TParseResult {
    return this.getDefinition().match(
      this as unknown as TSelf,
      value,
      context,
      path,
      parent,
      matchesPattern,
    );
  }

  compileToJSONSchema(
    context: Parameters<MatchJsonSchemaCompiler>[1],
    path: Parameters<MatchJsonSchemaCompiler>[2],
    mode: Parameters<MatchJsonSchemaCompiler>[3],
    compilePattern: MatchJsonSchemaCompiler,
  ): MatchJsonSchema {
    return this.getDefinition().compileToJSONSchema(
      this as unknown as TSelf,
      context,
      path,
      mode,
      compilePattern,
    );
  }

  appliesMessageOverrideToAggregate(): boolean {
    return (
      this.getDefinition().appliesMessageOverrideToAggregate?.(
        this as unknown as TSelf,
      ) ?? false
    );
  }

  isOptionalObjectProperty(): boolean {
    return (
      this.getDefinition().isOptionalObjectProperty?.(
        this as unknown as TSelf,
      ) ?? false
    );
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this, options);
  }
}

// ── Pattern classes ──────────────────────────────────────────────────────────

export class MaybePattern<TPattern = unknown> extends MatchPatternBase<
  TParseResult.Maybe<TPattern>,
  MaybePattern<TPattern>
> {
  public readonly kind = "Match.MaybePattern";
  constructor(public readonly pattern: TPattern) {
    super(
      maybePatternDefinition as MatchPatternDefinition<MaybePattern<TPattern>>,
    );
  }
}

export class OptionalPattern<TPattern = unknown> extends MatchPatternBase<
  TParseResult.Optional<TPattern>,
  OptionalPattern<TPattern>
> {
  public readonly kind = "Match.OptionalPattern";
  constructor(public readonly pattern: TPattern) {
    super(
      optionalPatternDefinition as MatchPatternDefinition<
        OptionalPattern<TPattern>
      >,
    );
  }
}

export class OneOfPattern<
  TPatterns extends readonly unknown[] = readonly [],
> extends MatchPatternBase<
  TParseResult.OneOf<TPatterns>,
  OneOfPattern<TPatterns>
> {
  public readonly kind = "Match.OneOfPattern";
  constructor(public readonly patterns: TPatterns) {
    super(
      oneOfPatternDefinition as MatchPatternDefinition<OneOfPattern<TPatterns>>,
    );
  }
}

export class WherePattern<TGuarded = unknown> extends MatchPatternBase<
  TGuarded,
  WherePattern<TGuarded>
> {
  public readonly kind = "Match.WherePattern";
  constructor(public readonly condition: WhereCondition<TGuarded>) {
    super(
      wherePatternDefinition as MatchPatternDefinition<WherePattern<TGuarded>>,
    );
  }
}

export class WithMessagePattern<TPattern = unknown> extends MatchPatternBase<
  TParseResult.WithMessage<TPattern>,
  WithMessagePattern<TPattern>
> {
  public readonly kind = "Match.WithMessagePattern";
  constructor(
    public readonly pattern: TPattern,
    public readonly message: MatchMessageOptions,
  ) {
    super(
      withMessagePatternDefinition as MatchPatternDefinition<
        WithMessagePattern<TPattern>
      >,
    );
  }
}

export class WithErrorPolicyPattern<
  TPattern = unknown,
> extends MatchPatternBase<
  TParseResult.WithErrorPolicy<TPattern>,
  WithErrorPolicyPattern<TPattern>
> {
  public readonly kind = "Match.WithErrorPolicyPattern";
  constructor(
    public readonly pattern: TPattern,
    public readonly errorPolicy: "first" | "all",
  ) {
    super(
      withErrorPolicyPatternDefinition as MatchPatternDefinition<
        WithErrorPolicyPattern<TPattern>
      >,
    );
  }
}

export class LazyPattern<TPattern = unknown> extends MatchPatternBase<
  TParseResult.Lazy<TPattern>,
  LazyPattern<TPattern>
> {
  public readonly kind = "Match.LazyPattern";
  private hasResolved = false;
  private resolvedPattern?: TPattern;
  private isResolving = false;

  constructor(private readonly resolver: () => TPattern) {
    super(
      lazyPatternDefinition as MatchPatternDefinition<LazyPattern<TPattern>>,
    );
  }

  resolve(): TPattern {
    if (this.hasResolved) return this.resolvedPattern as TPattern;
    if (this.isResolving) {
      throw createMatchPatternError(
        "Bad pattern: Match.Lazy resolver produced a circular unresolved reference.",
      );
    }

    this.isResolving = true;
    try {
      const resolved = this.resolver();
      if (resolved === undefined) {
        throw createMatchPatternError(
          "Bad pattern: Match.Lazy resolver must return a pattern.",
        );
      }
      // Resolving to itself would otherwise loop forever at match time.
      if ((resolved as unknown) === (this as unknown)) {
        throw createMatchPatternError(
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
> extends MatchPatternBase<InstanceType<TCtor>, ClassPattern<TCtor>> {
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
    super(
      classPatternDefinition as MatchPatternDefinition<ClassPattern<TCtor>>,
    );
  }
}

export class RegExpPattern<
  TExpression extends RegExp = RegExp,
> extends MatchPatternBase<string, RegExpPattern<TExpression>> {
  public readonly kind = "Match.RegExpPattern";
  public readonly expression: TExpression;

  constructor(expression: TExpression) {
    super(
      regExpPatternDefinition as MatchPatternDefinition<
        RegExpPattern<TExpression>
      >,
    );
    this.expression = new RegExp(
      expression.source,
      expression.flags,
    ) as TExpression;
  }
}

export class ObjectIncludingPattern<
  TObjectPattern extends Record<string, unknown> = Record<string, unknown>,
> extends MatchPatternBase<
  TParseResult.ObjectIncluding<TObjectPattern>,
  ObjectIncludingPattern<TObjectPattern>
> {
  public readonly kind = "Match.ObjectIncludingPattern";
  constructor(public readonly pattern: TObjectPattern) {
    super(
      objectIncludingPatternDefinition as MatchPatternDefinition<
        ObjectIncludingPattern<TObjectPattern>
      >,
    );
  }
}

export class ObjectStrictPattern<
  TObjectPattern extends Record<string, unknown> = Record<string, unknown>,
> extends MatchPatternBase<
  TParseResult.ObjectStrict<TObjectPattern>,
  ObjectStrictPattern<TObjectPattern>
> {
  public readonly kind = "Match.ObjectStrictPattern";
  constructor(public readonly pattern: TObjectPattern) {
    super(
      objectStrictPatternDefinition as MatchPatternDefinition<
        ObjectStrictPattern<TObjectPattern>
      >,
    );
  }
}

export class MapOfPattern<TPattern = unknown> extends MatchPatternBase<
  TParseResult.MapOf<TPattern>,
  MapOfPattern<TPattern>
> {
  public readonly kind = "Match.MapOfPattern";
  constructor(public readonly pattern: TPattern) {
    super(
      mapOfPatternDefinition as MatchPatternDefinition<MapOfPattern<TPattern>>,
    );
  }
}

export class NonEmptyArrayPattern<
  TPattern = undefined,
> extends MatchPatternBase<
  TParseResult.NonEmptyArray<TPattern>,
  NonEmptyArrayPattern<TPattern>
> {
  public readonly kind = "Match.NonEmptyArrayPattern";
  constructor(public readonly pattern?: TPattern) {
    super(
      nonEmptyArrayPatternDefinition as MatchPatternDefinition<
        NonEmptyArrayPattern<TPattern>
      >,
    );
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
