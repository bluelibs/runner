import { validationError } from "../errors";
import { check, Match } from "../tools/check";
import { hasClassSchemaMetadata } from "../tools/check/classSchema";
import { isClassConstructor, hasParseFunction } from "../tools/typeChecks";
import type {
  IValidationSchema,
  ValidationSchemaInput,
} from "../types/utilities";

type NormalizationContext = {
  definitionId: string;
  subject: string;
};

export function normalizeValidationSchema<T>(
  input: ValidationSchemaInput<T>,
  context: NormalizationContext,
): IValidationSchema<T> {
  if (hasParseFunction<T>(input)) {
    return input;
  }

  if (isClassConstructor(input)) {
    if (!hasClassSchemaMetadata(input)) {
      validationError.throw({
        subject: context.subject,
        id: context.definitionId,
        originalError: `Class schema shorthand requires @Match.Schema() metadata for ${input.name || "Anonymous"}.`,
      });
    }

    return Match.fromSchema(input) as IValidationSchema<T>;
  }

  return {
    parse(value: unknown): T {
      return check(value, input) as T;
    },
  };
}

export function normalizeOptionalValidationSchema<T>(
  input: ValidationSchemaInput<T> | undefined,
  context: NormalizationContext,
): IValidationSchema<T> | undefined {
  if (input === undefined) {
    return undefined;
  }

  return normalizeValidationSchema(input, context);
}
