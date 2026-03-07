import { MatchError } from "../errors";
import type { InferMatchPattern } from "../types";
import { collectMatchFailures } from "./core";

export function parsePatternValue<TPattern>(
  value: unknown,
  pattern: TPattern,
): InferMatchPattern<TPattern> {
  const failures = collectMatchFailures(value, pattern, false);
  if (failures.length === 0) return value as InferMatchPattern<TPattern>;
  throw new MatchError(failures);
}
