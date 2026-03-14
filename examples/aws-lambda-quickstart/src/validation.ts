type ValidationFailure = {
  path?: string;
  message?: string;
  expected?: string;
};

type ValidationErrorLike = {
  failures: ValidationFailure[];
};

export function isValidationError(error: unknown): error is ValidationErrorLike {
  return (
    !!error &&
    typeof error === "object" &&
    "failures" in error &&
    Array.isArray(error.failures)
  );
}

export function getValidationIssues(error: unknown) {
  if (isValidationError(error)) {
    return error.failures.map((failure) => ({
      path: failure.path ?? "$",
      message: failure.message ?? "Validation failed",
      expected: failure.expected,
    }));
  }

  return [
    {
      path: "$",
      message: error instanceof Error ? error.message : "Validation failed",
    },
  ];
}
