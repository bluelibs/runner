import type { DefaultErrorType, IErrorMeta, TagType } from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import { defineError } from "../../defineError";
import type { ErrorFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import { clone, mergeArray } from "./utils";
import { builderInvalidHttpCodeError } from "../../../errors";

const isValidHttpCode = (value: number): boolean =>
  Number.isInteger(value) && value >= 100 && value <= 599;

const assertHttpCode = (value: number): void => {
  if (!isValidHttpCode(value)) {
    builderInvalidHttpCodeError.throw({ value });
  }
};

/**
 * Creates an ErrorFluentBuilder from the given state.
 */
export function makeErrorBuilder<TData extends DefaultErrorType>(
  state: BuilderState<TData>,
): ErrorFluentBuilder<TData> {
  const builder: ErrorFluentBuilder<TData> = {
    id: state.id,

    httpCode(code: number) {
      assertHttpCode(code);
      const next = clone(state, { httpCode: code });
      return makeErrorBuilder(next);
    },

    serialize(fn) {
      const next = clone(state, { serialize: fn });
      return makeErrorBuilder(next);
    },

    parse(fn) {
      const next = clone(state, { parse: fn });
      return makeErrorBuilder(next);
    },

    dataSchema(schema) {
      const next = clone(state, { dataSchema: schema });
      return makeErrorBuilder(next);
    },

    schema(schema) {
      return builder.dataSchema(schema);
    },

    tags<TNewTags extends TagType[]>(
      t: TNewTags,
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

  return builder;
}
