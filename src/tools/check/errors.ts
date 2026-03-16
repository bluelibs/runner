import { RunnerError } from "../../definers/defineError";
import {
  checkInvalidOptionsError,
  checkInvalidPatternError,
  checkJsonSchemaUnsupportedPatternError,
  matchError,
} from "../../errors/foundation/match.errors";
import {
  createRootFailure,
  formatMatchErrorMessage,
  normalizeMatchFailures,
} from "./errorFormatting";
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
  code?: string;
  params?: Record<string, unknown>;
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
  const safeFailures = normalizeMatchFailures(failures);
  const [firstFailure] = safeFailures;
  const data = {
    path: firstFailure.path,
    failures: safeFailures,
  };

  if (!messageOverride) {
    return withProjectedFields(matchError.new(data), data);
  }

  return withProjectedFields(
    new RunnerError(
      MATCH_ERROR_ID,
      formatMatchErrorMessage(safeFailures, messageOverride),
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
  return withProjectedFields(
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
  return formatMatchErrorMessage(failures, messageOverride);
}

export function rootFailure(): MatchFailure {
  return createRootFailure();
}

function withProjectedFields<
  TError extends Error,
  TFields extends Record<string, unknown>,
>(error: TError, fields: TFields): TError & TFields {
  return Object.assign(error, fields);
}
