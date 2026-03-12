import { RunnerError } from "../../definers/defineError";

export const CHECK_ERROR_ID = "runner.errors.check.failed";
export const CHECK_INVALID_PATTERN_ERROR_ID =
  "runner.errors.check.invalidPattern";
export const CHECK_INVALID_OPTIONS_ERROR_ID =
  "runner.errors.check.invalidOptions";
export const CHECK_JSON_SCHEMA_UNSUPPORTED_PATTERN_ERROR_ID =
  "runner.errors.check.jsonSchemaUnsupportedPattern";

export interface MatchFailure {
  path: string;
  expected: string;
  actualType: string;
  message: string;
}

export interface MatchMessageOverride {
  message: string;
  appliesToAggregate: boolean;
}

export class MatchError extends RunnerError<{
  path: string;
  failures: readonly MatchFailure[];
}> {
  public readonly path: string;
  public readonly failures: readonly MatchFailure[];

  constructor(
    failures: readonly MatchFailure[],
    messageOverride?: MatchMessageOverride,
  ) {
    const safeFailures = failures.length === 0 ? [rootFailure()] : failures;
    const [firstFailure] = safeFailures;
    const summary =
      (messageOverride?.appliesToAggregate || safeFailures.length === 1
        ? messageOverride?.message
        : undefined) ??
      (safeFailures.length === 1
        ? firstFailure.message
        : `Match failed with ${safeFailures.length} errors:\n${safeFailures.map((f) => `- ${f.message}`).join("\n")}`);

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

export class CheckJsonSchemaPatternError extends RunnerError<{
  path: string;
  reason: string;
  patternKind: string;
}> {
  public readonly path: string;
  public readonly reason: string;
  public readonly patternKind: string;

  constructor(path: string, reason: string, patternKind: string) {
    super(
      CHECK_JSON_SCHEMA_UNSUPPORTED_PATTERN_ERROR_ID,
      `Cannot convert Match pattern at ${path}: ${reason}.`,
      { path, reason, patternKind },
    );
    this.path = path;
    this.reason = reason;
    this.patternKind = patternKind;
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
