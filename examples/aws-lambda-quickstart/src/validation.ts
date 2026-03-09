import { Match } from "@bluelibs/runner";

export const createUserSchema = Match.compile({
  name: Match.NonEmptyString,
});

export const getUserSchema = Match.compile({
  id: Match.NonEmptyString,
});

export function getValidationIssues(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "failures" in error &&
    Array.isArray((error as { failures?: unknown }).failures)
  ) {
    return (
      error as {
        failures: Array<{ path?: string; message?: string; expected?: string }>;
      }
    ).failures.map((failure) => ({
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
