import { error } from "../../definers/builders/error";
import type { DefaultErrorType } from "../../types/error";

// Validation error (input, result, config)
export const validationError = error<
  {
    subject: string;
    id: string;
    originalError: string | Error;
  } & DefaultErrorType
>("runner.errors.validation")
  .format(({ subject, id, originalError }) => {
    const errorMessage =
      originalError instanceof Error
        ? originalError.message
        : String(originalError);
    return `${subject} validation failed for ${id.toString()}: ${errorMessage}`;
  })
  .remediation(({ subject, id }) => {
    const lower = subject.toLowerCase();
    const schemaHint = lower.includes("input")
      ? "inputSchema"
      : lower.includes("config")
        ? "configSchema"
        : lower.includes("result")
          ? "resultSchema"
          : "schema";
    return `Check the ${subject} passed to "${id.toString()}". Ensure it matches the schema defined via .${schemaHint}().`;
  })
  .build();

/** Canonical error for input validation failures */
export const inputSchemaValidationError = validationError;
/** Canonical error for result validation failures */
export const resultSchemaValidationError = validationError;

/** Builder types that require validation before build() */
export type BuilderType =
  | "task"
  | "hook"
  | "task-middleware"
  | "resource-middleware";

// Builder incomplete (missing required fields)
export const builderIncompleteError = error<
  {
    type: BuilderType;
    builderId: string;
    missingFields: string[];
  } & DefaultErrorType
>("runner.errors.builderIncomplete")
  .format(({ type, builderId, missingFields }) => {
    const typeLabel =
      type === "task"
        ? "Task"
        : type === "hook"
          ? "Hook"
          : type === "task-middleware"
            ? "Task middleware"
            : "Resource middleware";
    return `${typeLabel} "${builderId}" is incomplete. Missing required: ${missingFields.join(", ")}. Call ${missingFields.map((f) => `.${f}()`).join(" and ")} before .build().`;
  })
  .remediation(
    ({ missingFields }) =>
      `Add the missing builder steps: ${missingFields.map((f) => `.${f}()`).join(", ")} before calling .build().`,
  )
  .build();
