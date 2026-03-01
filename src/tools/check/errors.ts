import { RunnerError } from "../../definers/defineError";

export const CHECK_ERROR_ID = "runner.errors.check.failed";
export const CHECK_INVALID_PATTERN_ERROR_ID =
  "runner.errors.check.invalidPattern";
export const CHECK_INVALID_OPTIONS_ERROR_ID =
  "runner.errors.check.invalidOptions";

export interface MatchFailure {
  path: string;
  expected: string;
  actualType: string;
  message: string;
}

export class MatchError extends RunnerError<{
  path: string;
  failures: readonly MatchFailure[];
}> {
  public readonly path: string;
  public readonly failures: readonly MatchFailure[];

  constructor(failures: readonly MatchFailure[]) {
    const safeFailures = failures.length === 0 ? [rootFailure()] : failures;
    const [firstFailure] = safeFailures;
    const summary =
      safeFailures.length === 1
        ? firstFailure.message
        : `Match failed with ${safeFailures.length} errors. First error: ${firstFailure.message}`;

    super(CHECK_ERROR_ID, summary, {
      path: firstFailure.path,
      failures: safeFailures,
    });

    this.path = firstFailure.path;
    this.failures = safeFailures;
  }
}

export class MatchPatternError extends RunnerError<{ message: string }> {
  constructor(message: string) {
    super(CHECK_INVALID_PATTERN_ERROR_ID, message, { message });
  }
}

export class CheckOptionsError extends RunnerError<{ message: string }> {
  constructor(message: string) {
    super(CHECK_INVALID_OPTIONS_ERROR_ID, message, { message });
  }
}

function rootFailure(): MatchFailure {
  return {
    path: "$",
    expected: "valid pattern",
    actualType: "unknown",
    message: "Match failed at $.",
  };
}
