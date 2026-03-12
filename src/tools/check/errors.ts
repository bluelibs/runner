import { RunnerError } from "../../definers/defineError";
import {
  checkInvalidOptionsError,
  checkInvalidPatternError,
  checkJsonSchemaUnsupportedPatternError,
  matchError,
} from "../../errors/foundation/match.errors";
import type { IErrorHelper } from "../../types/error";
import { symbolDefinitionIdentity } from "../../types/symbols";

export const MATCH_ERROR_ID = matchError.id;
export const CHECK_INVALID_PATTERN_ERROR_ID = checkInvalidPatternError.id;
export const CHECK_INVALID_OPTIONS_ERROR_ID = checkInvalidOptionsError.id;
export const CHECK_JSON_SCHEMA_UNSUPPORTED_PATTERN_ERROR_ID =
  checkJsonSchemaUnsupportedPatternError.id;

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

export type ErrorType<TErrorHelper extends IErrorHelper<any>> = ReturnType<
  TErrorHelper["new"]
>;

export type MatchRuntimeError = ErrorType<typeof matchError> & {
  path: string;
  failures: readonly MatchFailure[];
};

export type MatchPatternRuntimeError = ErrorType<
  typeof checkInvalidPatternError
> & {
  message: string;
};

export type CheckOptionsRuntimeError = ErrorType<
  typeof checkInvalidOptionsError
> & {
  message: string;
};

export type CheckJsonSchemaPatternRuntimeError = ErrorType<
  typeof checkJsonSchemaUnsupportedPatternError
> & {
  path: string;
  reason: string;
  patternKind: string;
};

export function createMatchError(
  failures: readonly MatchFailure[],
  messageOverride?: MatchMessageOverride,
): MatchRuntimeError {
  const safeFailures = failures.length === 0 ? [rootFailure()] : failures;
  const [firstFailure] = safeFailures;
  const data = {
    path: firstFailure.path,
    failures: safeFailures,
  };

  if (!messageOverride) {
    return Object.assign(matchError.new(data), data);
  }

  return Object.assign(
    new RunnerError(
      MATCH_ERROR_ID,
      getMatchErrorMessage(safeFailures, messageOverride),
      data,
      matchError.httpCode,
      undefined,
      matchError[symbolDefinitionIdentity],
    ),
    data,
  );
}

export function isMatchError(error: unknown): error is MatchRuntimeError {
  return matchError.is(error);
}

export function createMatchPatternError(
  message: string,
): MatchPatternRuntimeError {
  return checkInvalidPatternError.new({ message });
}

export function createCheckOptionsError(
  message: string,
): CheckOptionsRuntimeError {
  return checkInvalidOptionsError.new({ message });
}

export function createCheckJsonSchemaPatternError(
  path: string,
  reason: string,
  patternKind: string,
): CheckJsonSchemaPatternRuntimeError {
  return Object.assign(
    checkJsonSchemaUnsupportedPatternError.new({ path, reason, patternKind }),
    {
      path,
      reason,
      patternKind,
    },
  );
}

export function getMatchErrorMessage(
  failures: readonly MatchFailure[],
  messageOverride?: MatchMessageOverride,
): string {
  const [firstFailure] = failures;

  return (
    (messageOverride?.appliesToAggregate || failures.length === 1
      ? messageOverride?.message
      : undefined) ??
    (failures.length === 1
      ? firstFailure.message
      : `Match failed with ${failures.length} errors:\n${failures.map((failure) => `- ${failure.message}`).join("\n")}`)
  );
}

export function rootFailure(): MatchFailure {
  return {
    path: "$",
    expected: "valid pattern",
    actualType: "unknown",
    message: "Match failed at $.",
  };
}
