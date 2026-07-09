import type {
  DefaultErrorType,
  EnsureTagsForTarget,
  ErrorTagType,
  ResolveValidationSchemaInput,
  IErrorMeta,
  ValidationSchemaInput,
} from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import { defineError, RunnerError } from "../../defineError";
import type { ErrorFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import { clone, mergeArray } from "./utils";
import { getBuilderInvalidHttpCodeError } from "../../foundationErrorRegistry";

const isValidHttpCode = (value: number): boolean =>
  Number.isInteger(value) && value >= 100 && value <= 599;

const assertHttpCode = (value: number): void => {
  if (!isValidHttpCode(value)) {
    const registeredError = getBuilderInvalidHttpCodeError();
    if (registeredError) {
      registeredError.throw({ value });
    }
    throw new RunnerError(
      "builder-invalidHttpCode",
      `Error httpCode must be an integer between 100 and 599. Received: ${value}`,
      { value },
      undefined,
      "Use a valid HTTP status code in the 100-599 range when configuring error helpers.",
    );
  }
};

/**
 * Creates an ErrorFluentBuilder from the given state.
 */
export function makeErrorBuilder<TData extends DefaultErrorType>(
  state: BuilderState<TData>,
): ErrorFluentBuilder<TData> {
  const builder = {
    id: state.id,

    httpCode(code: number) {
      assertHttpCode(code);
      const next = clone(state, { httpCode: code });
      return makeErrorBuilder(next);
    },

    serialize(fn: (data: TData) => string) {
      const next = clone(state, { serialize: fn });
      return makeErrorBuilder(next);
    },

    parse(fn: (raw: string) => TData) {
      const next = clone(state, { parse: fn });
      return makeErrorBuilder(next);
    },

    dataSchema<
      TNewData extends DefaultErrorType = never,
      TSchema extends ValidationSchemaInput<
        [TNewData] extends [never] ? any : TNewData
      > = ValidationSchemaInput<[TNewData] extends [never] ? any : TNewData>,
    >(schema: TSchema) {
      const next = clone(state as BuilderState<any>, {
        dataSchema: schema,
      }) as BuilderState<
        ResolveValidationSchemaInput<TNewData, TSchema> & DefaultErrorType
      >;
      return makeErrorBuilder<
        ResolveValidationSchemaInput<TNewData, TSchema> & DefaultErrorType
      >(next);
    },

    schema<
      TNewData extends DefaultErrorType = never,
      TSchema extends ValidationSchemaInput<
        [TNewData] extends [never] ? any : TNewData
      > = ValidationSchemaInput<[TNewData] extends [never] ? any : TNewData>,
    >(schema: TSchema) {
      return builder.dataSchema(schema);
    },

    tags<TNewTags extends ErrorTagType[]>(
      t: EnsureTagsForTarget<"errors", TNewTags>,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = clone(state, {
        tags: mergeArray(state.tags ?? [], t, override),
      });
      return makeErrorBuilder(next);
    },

    format(fn: (data: TData) => string) {
      const next = clone(state, { format: fn });
      return makeErrorBuilder(next);
    },

    remediation(advice: string | ((data: TData) => string)) {
      const next = clone(state, { remediation: advice });
      return makeErrorBuilder(next);
    },

    meta<TNewMeta extends IErrorMeta>(m: TNewMeta) {
      const next = clone(state, { meta: m });
      return makeErrorBuilder(next);
    },

    build() {
      return deepFreeze(
        defineError<TData>(
          {
            id: state.id,
            httpCode: state.httpCode,
            serialize: state.serialize,
            parse: state.parse,
            dataSchema: state.dataSchema,
            format: state.format,
            remediation: state.remediation,
            meta: state.meta,
            tags: state.tags,
          },
          state.filePath,
        ),
      );
    },
  };

  return builder as ErrorFluentBuilder<TData>;
}
