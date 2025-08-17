/**
 * Generic validation schema interface that can be implemented by any validation library.
 * Compatible with Zod, Yup, Joi, and other validation libraries.
 */
export interface IValidationSchema<T = any> {
  /**
   * Parse and validate the input data.
   * Should throw an error if validation fails.
   * Can transform the data if the schema supports transformations.
   */
  parse(input: unknown): T;
}
