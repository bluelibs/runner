import { frameworkError as error } from "../../definers/builders/error";
import type { DefaultErrorType } from "../../types/error";
import type { MatchFailure } from "../../tools/check/errors";

export const matchError = error<
  {
    path: string;
    failures: readonly MatchFailure[];
  } & DefaultErrorType
>("runner.errors.matchError")
  .httpCode(400)
  .format(({ failures }) => {
    const safeFailures =
      failures.length === 0
        ? [
            {
              path: "$",
              expected: "valid pattern",
              actualType: "unknown",
              message: "Match failed at $.",
            },
          ]
        : failures;
    const [firstFailure] = safeFailures;

    return safeFailures.length === 1
      ? firstFailure.message
      : `Match failed with ${safeFailures.length} errors:\n${safeFailures.map((failure) => `- ${failure.message}`).join("\n")}`;
  })
  .build();

export const checkInvalidPatternError = error<
  { message: string } & DefaultErrorType
>("runner.errors.check.invalidPattern")
  .httpCode(400)
  .format(({ message }) => message)
  .remediation("Fix the invalid Match pattern definition before using it.")
  .build();

export const checkInvalidOptionsError = error<
  { message: string } & DefaultErrorType
>("runner.errors.check.invalidOptions")
  .httpCode(400)
  .format(({ message }) => message)
  .remediation("Pass a plain object with supported check() options.")
  .build();

export const checkJsonSchemaUnsupportedPatternError = error<
  {
    path: string;
    reason: string;
    patternKind: string;
  } & DefaultErrorType
>("runner.errors.check.jsonSchemaUnsupportedPattern")
  .httpCode(400)
  .format(
    ({ path, reason }) => `Cannot convert Match pattern at ${path}: ${reason}.`,
  )
  .remediation(
    "Remove runtime-only Match constructs or disable strict JSON Schema export.",
  )
  .build();
