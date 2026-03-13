import { frameworkError as error } from "../../definers/builders/error";
import type { DefaultErrorType } from "../../types/error";
import type { MatchFailure } from "../../tools/check/errors";
import { formatMatchErrorMessage } from "../../tools/check/errorFormatting";

export const matchError = error<
  {
    path: string;
    failures: readonly MatchFailure[];
  } & DefaultErrorType
>("matchError")
  .httpCode(400)
  .format(({ failures }) => formatMatchErrorMessage(failures))
  .build();

export const checkInvalidPatternError = error<
  { message: string } & DefaultErrorType
>("check-invalidPattern")
  .httpCode(400)
  .format(({ message }) => message)
  .remediation("Fix the invalid Match pattern definition before using it.")
  .build();

export const checkInvalidOptionsError = error<
  { message: string } & DefaultErrorType
>("check-invalidOptions")
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
>("check-jsonSchemaUnsupportedPattern")
  .httpCode(400)
  .format(
    ({ path, reason }) => `Cannot convert Match pattern at ${path}: ${reason}.`,
  )
  .remediation(
    "Remove runtime-only Match constructs or disable strict JSON Schema export.",
  )
  .build();
