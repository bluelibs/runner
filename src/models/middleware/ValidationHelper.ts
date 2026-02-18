import { validationError } from "../../errors";
import type { IValidationSchema } from "../../defs";
import { normalizeError } from "../../globals/resources/tunnel/error-utils";

/**
 * Centralized validation logic for inputs and results across tasks and resources.
 * Provides consistent error handling and messaging.
 */
export class ValidationHelper {
  /**
   * Validates input using the provided schema
   * @throws ValidationError if validation fails
   */
  static validateInput<T>(
    value: unknown,
    schema: IValidationSchema<T> | undefined,
    id: string,
    type: "Task" | "Resource",
  ): T {
    if (!schema) return value as T;

    try {
      return schema.parse(value);
    } catch (error) {
      return validationError.throw({
        subject: `${type} input`,
        id,
        originalError: normalizeError(error),
      });
    }
  }

  /**
   * Validates result using the provided schema
   * @throws ValidationError if validation fails
   */
  static validateResult<T>(
    value: unknown,
    schema: IValidationSchema<T> | undefined,
    id: string,
    type: "Task" | "Resource",
  ): T {
    if (!schema) return value as T;

    try {
      return schema.parse(value);
    } catch (error) {
      return validationError.throw({
        subject: `${type} result`,
        id,
        originalError: normalizeError(error),
      });
    }
  }
}
