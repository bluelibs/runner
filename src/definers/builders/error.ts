import type { DefaultErrorType } from "../../types/error";
import { defineError, ErrorHelper } from "../defineError";
import type { IValidationSchema } from "../../types/utilities";

type BuilderState<TData extends DefaultErrorType> = Readonly<{
  id: string;
  serialize?: (data: TData) => string;
  parse?: (raw: string) => TData;
  dataSchema?: IValidationSchema<TData>;
}>;

function clone<TData extends DefaultErrorType>(
  s: BuilderState<TData>,
  patch: Partial<BuilderState<TData>>,
) {
  return Object.freeze({ ...s, ...patch }) as BuilderState<TData>;
}

export interface ErrorFluentBuilder<
  TData extends DefaultErrorType = DefaultErrorType,
> {
  id: string;
  serialize(fn: (data: TData) => string): ErrorFluentBuilder<TData>;
  parse(fn: (raw: string) => TData): ErrorFluentBuilder<TData>;
  dataSchema(schema: IValidationSchema<TData>): ErrorFluentBuilder<TData>;
  build(): ErrorHelper<TData>;
}

function makeErrorBuilder<TData extends DefaultErrorType>(
  state: BuilderState<TData>,
): ErrorFluentBuilder<TData> {
  const b: ErrorFluentBuilder<TData> = {
    id: state.id,
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
    build() {
      return defineError<TData>({
        id: state.id,
        serialize: state.serialize,
        parse: state.parse,
        dataSchema: state.dataSchema,
      });
    },
  };
  return b;
}

export function errorBuilder<TData extends DefaultErrorType = DefaultErrorType>(
  id: string,
): ErrorFluentBuilder<TData> {
  const initial: BuilderState<TData> = Object.freeze({
    id,
    serialize: undefined,
    parse: undefined,
    dataSchema: undefined,
  });
  return makeErrorBuilder(initial);
}

export const error = errorBuilder;
