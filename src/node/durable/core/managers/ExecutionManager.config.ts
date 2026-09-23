import { check, Match } from "../../../../tools/check";
import type { DurableServiceConfig } from "../interfaces/service";

const executionTuningPattern = Match.ObjectIncluding({
  // NaN or a fractional/negative bound would silently disable or skew the
  // depth guard, so reject it where the operator set it. Zero stays valid:
  // it is the documented way to disable continue-as-new.
  maxContinuationDepth: Match.Optional(
    Match.WithMessage(
      Match.Range({ min: 0, integer: true }),
      "execution.maxContinuationDepth must be a non-negative integer.",
    ),
  ),
});

/** Fails fast on execution tuning values that would break runtime guards. */
export function assertExecutionTuningConfig(
  execution: DurableServiceConfig["execution"],
): void {
  if (execution === undefined) return;
  check(execution, executionTuningPattern);
}
