import { validationError } from "../../errors";

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
    value: any,
    schema: { parse: (v: any) => T } | undefined,
    id: string,
    type: "Task" | "Resource",
  ): T {
    if (!schema) return value;

    try {
      return schema.parse(value);
    } catch (error) {
      return validationError.throw({
        subject: `${type} input`,
        id,
        originalError: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * Validates result using the provided schema
   * @throws ValidationError if validation fails
   */
  static validateResult<T>(
    value: any,
    schema: { parse: (v: any) => T } | undefined,
    id: string,
    type: "Task" | "Resource",
  ): T {
    if (!schema) return value;

    try {
      return schema.parse(value);
    } catch (error) {
      return validationError.throw({
        subject: `${type} result`,
        id,
        originalError: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
}
