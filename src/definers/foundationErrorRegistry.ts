import type { DefaultErrorType, IErrorHelper } from "../types/error";

export type ValidationErrorData = {
  subject: string;
  id: string;
  originalError: string | Error;
} & DefaultErrorType;

export type BuilderInvalidHttpCodeErrorData = {
  value: number;
} & DefaultErrorType;

let validationError: IErrorHelper<ValidationErrorData> | undefined;
let builderInvalidHttpCodeError:
  | IErrorHelper<BuilderInvalidHttpCodeErrorData>
  | undefined;

/** Registers the typed validation helper after foundation errors initialize. */
export function registerValidationError(
  error: IErrorHelper<ValidationErrorData>,
): void {
  validationError = error;
}

/** Returns the typed validation helper when foundation errors are initialized. */
export function getValidationError():
  | IErrorHelper<ValidationErrorData>
  | undefined {
  return validationError;
}

/** Registers the typed builder diagnostic after domain errors initialize. */
export function registerBuilderInvalidHttpCodeError(
  error: IErrorHelper<BuilderInvalidHttpCodeErrorData>,
): void {
  builderInvalidHttpCodeError = error;
}

/** Returns the typed builder diagnostic when domain errors are initialized. */
export function getBuilderInvalidHttpCodeError():
  | IErrorHelper<BuilderInvalidHttpCodeErrorData>
  | undefined {
  return builderInvalidHttpCodeError;
}
