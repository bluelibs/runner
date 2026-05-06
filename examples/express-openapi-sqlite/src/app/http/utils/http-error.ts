import { errors, RunnerError } from "@bluelibs/runner";

type ValidationIssue = {
  path: string;
  message: string;
  expected?: string;
};

type ResolvedHttpError = {
  statusCode: number;
  message: string;
  validationErrors?: readonly ValidationIssue[];
};

function isTaskInputValidationError(
  error: unknown,
): error is Error & {
  readonly data: {
    readonly originalError?: unknown;
  };
  readonly id?: string;
} {
  return errors.validationError.is(error, { subject: "Task input" });
}

function isMatchError(
  error: unknown,
): error is ReturnType<(typeof errors.matchError)["new"]> {
  return errors.matchError.is(error);
}

function toValidationIssues(
  error: ReturnType<(typeof errors.matchError)["new"]>,
): readonly ValidationIssue[] {
  return error.data.failures.map((failure) => ({
    path: failure.path,
    message: failure.message,
    expected: failure.expected,
  }));
}

function resolveValidationDetails(error: unknown): readonly ValidationIssue[] | undefined {
  if (isMatchError(error)) {
    return toValidationIssues(error);
  }

  return undefined;
}

export function resolveHttpError(error: unknown): ResolvedHttpError {
  if (error instanceof RunnerError && error.httpCode) {
    return {
      statusCode: error.httpCode,
      message: error.message,
      validationErrors: resolveValidationDetails(error),
    };
  }

  if (isTaskInputValidationError(error)) {
    const originalError = error.data.originalError;
    const message =
      originalError instanceof Error
        ? originalError.message
        : error.message;

    return {
      statusCode: 400,
      message,
      validationErrors: resolveValidationDetails(originalError),
    };
  }

  if (isMatchError(error)) {
    return {
      statusCode: 400,
      message: error.message,
      validationErrors: toValidationIssues(error),
    };
  }

  return {
    statusCode: 500,
    message: "Internal server error",
  };
}
