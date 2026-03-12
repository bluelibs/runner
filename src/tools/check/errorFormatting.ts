import type { MatchFailure, MatchMessageOverride } from "./errors";

export function createRootFailure(): MatchFailure {
  return {
    path: "$",
    expected: "valid pattern",
    actualType: "unknown",
    message: "Match failed at $.",
  };
}

export function normalizeMatchFailures(
  failures: readonly MatchFailure[],
): readonly MatchFailure[] {
  return failures.length === 0 ? [createRootFailure()] : failures;
}

export function formatMatchErrorMessage(
  failures: readonly MatchFailure[],
  messageOverride?: MatchMessageOverride,
): string {
  const safeFailures = normalizeMatchFailures(failures);
  const [firstFailure] = safeFailures;

  return (
    (messageOverride?.appliesToAggregate || safeFailures.length === 1
      ? messageOverride?.message
      : undefined) ??
    (safeFailures.length === 1
      ? firstFailure.message
      : `Match failed with ${safeFailures.length} errors:\n${safeFailures.map((failure) => `- ${failure.message}`).join("\n")}`)
  );
}
