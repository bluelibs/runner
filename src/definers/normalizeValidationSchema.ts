import { validationError } from "../errors";
import { check, Match } from "../tools/check";
import { hasClassSchemaMetadata } from "../tools/check/classSchema";
import type {
  IValidationSchema,
  ValidationSchemaClassConstructor,
  ValidationSchemaInput,
} from "../types/utilities";

type NormalizationContext = {
  definitionId: string;
  subject: string;
};

function isClassConstructor(
  value: unknown,
): value is ValidationSchemaClassConstructor {
  if (typeof value !== "function") return false;

  const prototype = (value as { prototype?: unknown }).prototype;
  if (!prototype || typeof prototype !== "object") return false;

  return (prototype as { constructor?: unknown }).constructor === value;
}

function hasParseFunction<T>(value: unknown): value is IValidationSchema<T> {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    return false;
  }

  return typeof (value as { parse?: unknown }).parse === "function";
}

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
