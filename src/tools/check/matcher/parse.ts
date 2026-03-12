import { createMatchError } from "../errors";
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
  if (failures.length === 0) return value as InferMatchPattern<TPattern>;
  throw createMatchError(failures, messageOverride);
}
