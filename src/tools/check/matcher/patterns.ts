import { MatchPatternError } from "../errors";
import { matchToJsonSchema } from "../toJsonSchema";
import type {
  InferMatchPattern,
  MatchJsonSchema,
  MatchToJsonSchemaOptions,
} from "../types";
import type { NonEmptyArrayElement, WhereCondition } from "./shared";
import { parsePatternValue } from "./parse";

export class MaybePattern<TPattern = unknown> {
  public readonly kind = "Match.MaybePattern";

  constructor(public readonly pattern: TPattern) {}

  parse(value: unknown): InferMatchPattern<TPattern> | null | undefined {
    return parsePatternValue(value, this as MaybePattern<TPattern>) as
      | InferMatchPattern<TPattern>
      | null
      | undefined;
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as MaybePattern<TPattern>, options);
  }
}

export class OptionalPattern<TPattern = unknown> {
  public readonly kind = "Match.OptionalPattern";

  constructor(public readonly pattern: TPattern) {}

  parse(value: unknown): InferMatchPattern<TPattern> | undefined {
    return parsePatternValue(value, this as OptionalPattern<TPattern>) as
      | InferMatchPattern<TPattern>
      | undefined;
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as OptionalPattern<TPattern>, options);
  }
}

export class OneOfPattern<TPatterns extends readonly unknown[] = readonly []> {
  public readonly kind = "Match.OneOfPattern";

  constructor(public readonly patterns: TPatterns) {}

  parse(value: unknown): InferMatchPattern<TPatterns[number]> {
    return parsePatternValue(
      value,
      this as OneOfPattern<TPatterns>,
    ) as InferMatchPattern<TPatterns[number]>;
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as OneOfPattern<TPatterns>, options);
  }
}

export class WherePattern<TGuarded = unknown> {
  public readonly kind = "Match.WherePattern";

  constructor(public readonly condition: WhereCondition<TGuarded>) {}

  parse(value: unknown): TGuarded {
    return parsePatternValue(value, this as WherePattern<TGuarded>) as TGuarded;
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as WherePattern<TGuarded>, options);
  }
}

export class LazyPattern<TPattern = unknown> {
  public readonly kind = "Match.LazyPattern";

  private hasResolved = false;
  private resolvedPattern?: TPattern;
  private isResolving = false;

  constructor(private readonly resolver: () => TPattern) {}

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

  parse(value: unknown): InferMatchPattern<TPattern> {
    return parsePatternValue(
      value,
      this as LazyPattern<TPattern>,
    ) as InferMatchPattern<TPattern>;
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as LazyPattern<TPattern>, options);
  }
}

export class ClassPattern<
  TCtor extends abstract new (...args: never[]) => unknown,
> {
  public readonly kind = "Match.ClassPattern";

  constructor(
    public readonly ctor: TCtor,
    public readonly options?: { exact?: boolean; schemaId?: string },
  ) {}

  parse(value: unknown): InstanceType<TCtor> {
    return parsePatternValue(
      value,
      this as ClassPattern<TCtor>,
    ) as InstanceType<TCtor>;
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as ClassPattern<TCtor>, options);
  }
}

export class RegExpPattern<TExpression extends RegExp = RegExp> {
  public readonly kind = "Match.RegExpPattern";
  public readonly expression: TExpression;

  constructor(expression: TExpression) {
    this.expression = new RegExp(
      expression.source,
      expression.flags,
    ) as TExpression;
  }

  parse(value: unknown): string {
    return parsePatternValue(
      value,
      this as RegExpPattern<TExpression>,
    ) as string;
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as RegExpPattern<TExpression>, options);
  }
}

export class ObjectIncludingPattern<
  TObjectPattern extends Record<string, unknown> = Record<string, unknown>,
> {
  public readonly kind = "Match.ObjectIncludingPattern";

  constructor(public readonly pattern: TObjectPattern) {}

  parse(
    value: unknown,
  ): InferMatchPattern<TObjectPattern> & Record<string, unknown> {
    return parsePatternValue(
      value,
      this as ObjectIncludingPattern<TObjectPattern>,
    ) as InferMatchPattern<TObjectPattern> & Record<string, unknown>;
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(
      this as ObjectIncludingPattern<TObjectPattern>,
      options,
    );
  }
}

export class ObjectStrictPattern<
  TObjectPattern extends Record<string, unknown> = Record<string, unknown>,
> {
  public readonly kind = "Match.ObjectStrictPattern";

  constructor(public readonly pattern: TObjectPattern) {}

  parse(value: unknown): InferMatchPattern<TObjectPattern> {
    return parsePatternValue(
      value,
      this as ObjectStrictPattern<TObjectPattern>,
    ) as InferMatchPattern<TObjectPattern>;
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(
      this as ObjectStrictPattern<TObjectPattern>,
      options,
    );
  }
}

export class MapOfPattern<TPattern = unknown> {
  public readonly kind = "Match.MapOfPattern";

  constructor(public readonly pattern: TPattern) {}

  parse(value: unknown): Record<string, InferMatchPattern<TPattern>> {
    return parsePatternValue(value, this as MapOfPattern<TPattern>) as Record<
      string,
      InferMatchPattern<TPattern>
    >;
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as MapOfPattern<TPattern>, options);
  }
}

export class NonEmptyArrayPattern<TPattern = undefined> {
  public readonly kind = "Match.NonEmptyArrayPattern";

  constructor(public readonly pattern?: TPattern) {}

  parse(
    value: unknown,
  ): [NonEmptyArrayElement<TPattern>, ...NonEmptyArrayElement<TPattern>[]] {
    return parsePatternValue(value, this as NonEmptyArrayPattern<TPattern>) as [
      NonEmptyArrayElement<TPattern>,
      ...NonEmptyArrayElement<TPattern>[],
    ];
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this as NonEmptyArrayPattern<TPattern>, options);
  }
}
