import { createMatchError } from "./errors";
import { DEFAULT_MATCH_MAX_DEPTH } from "./matcher/shared";
import { hydrateMatchedValue } from "./hydration";
import { collectMatchFailures, collectMatchResult } from "./matcher";
import { matchToJsonSchema } from "./toJsonSchema";
import type {
  InferMatchPattern,
  MatchCompiledSchema,
  MatchJsonSchema,
  MatchPattern,
  MatchToJsonSchemaOptions,
} from "./types";
import {
  type MatchCompileOptions,
  resolveDefaultCollectAll,
  resolveMaxDepth,
} from "./checkOptions";

class CompiledMatchPatternSchema<
  TPattern extends MatchPattern,
> implements MatchCompiledSchema<TPattern> {
  constructor(
    public readonly pattern: TPattern,
    private readonly maxDepth: number,
  ) {}

  parse(input: unknown): InferMatchPattern<TPattern> {
    const collectAll = resolveDefaultCollectAll(this.pattern);
    const { failures, messageOverride } = collectMatchResult(
      input,
      this.pattern,
      collectAll,
      this.maxDepth,
    );
    if (failures.length === 0) {
      return hydrateMatchedValue(
        input,
        this.pattern,
      ) as InferMatchPattern<TPattern>;
    }
    throw createMatchError(failures, messageOverride);
  }

  test(input: unknown): input is InferMatchPattern<TPattern> {
    return (
      collectMatchFailures(input, this.pattern, false, this.maxDepth).length ===
      0
    );
  }

  toJSONSchema(options?: MatchToJsonSchemaOptions): MatchJsonSchema {
    return matchToJsonSchema(this.pattern, options);
  }
}

export function compileMatchPattern<TPattern extends MatchPattern>(
  pattern: TPattern,
  options?: MatchCompileOptions,
): MatchCompiledSchema<TPattern> {
  const maxDepth =
    resolveMaxDepth(options?.maxDepth) ?? DEFAULT_MATCH_MAX_DEPTH;
  return Object.freeze(new CompiledMatchPatternSchema(pattern, maxDepth));
}

export function matchTest<TPattern extends MatchPattern>(
  value: unknown,
  pattern: TPattern,
  options?: MatchCompileOptions,
): value is InferMatchPattern<TPattern> {
  const maxDepth =
    resolveMaxDepth(options?.maxDepth) ?? DEFAULT_MATCH_MAX_DEPTH;
  return collectMatchFailures(value, pattern, false, maxDepth).length === 0;
}
