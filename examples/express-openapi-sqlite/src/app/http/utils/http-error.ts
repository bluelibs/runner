import { errors, RunnerError } from "@bluelibs/runner";

export function resolveHttpError(error: unknown) {
  if (error instanceof RunnerError && error.httpCode) {
    return { statusCode: error.httpCode, message: error.message };
  }

  if (errors.validationError.is(error, { subject: "Task input" })) {
    const originalError = error.data.originalError;
    const message =
      originalError instanceof Error ? originalError.message : error.message;

    return { statusCode: 400, message };
  }

  if (errors.matchError.is(error)) {
    return { statusCode: 400, message: error.message };
  }

  return {
    statusCode: 500,
    message: "Internal server error",
  };
}
