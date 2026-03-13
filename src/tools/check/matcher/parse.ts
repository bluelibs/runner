import { createMatchError } from "../errors";
import { hydrateMatchedValue } from "../hydration";
import type { InferMatchPattern } from "../types";
import { collectMatchResult } from "./core";

export function parsePatternValue<TPattern>(
  value: unknown,
  pattern: TPattern,
): InferMatchPattern<TPattern> {
  const { failures, messageOverride } = collectMatchResult(
    value,
    pattern,
    false,
  );
  if (failures.length === 0) {
    return hydrateMatchedValue(value, pattern) as InferMatchPattern<TPattern>;
  }
  throw createMatchError(failures, messageOverride);
}
