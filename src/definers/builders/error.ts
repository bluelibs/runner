import type { DefaultErrorType } from "../../types/error";
import { defineError, ErrorHelper } from "../defineError";
import type { IValidationSchema } from "../../types/utilities";
import type { IErrorMeta } from "../../types/meta";

type BuilderState<TData extends DefaultErrorType> = Readonly<{
  id: string;
  format?: (data: TData) => string;
  serialize?: (data: TData) => string;
  parse?: (raw: string) => TData;
  dataSchema?: IValidationSchema<TData>;
  meta?: IErrorMeta;
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
  format(fn: (data: TData) => string): ErrorFluentBuilder<TData>;
  meta<TNewMeta extends IErrorMeta>(m: TNewMeta): ErrorFluentBuilder<TData>;
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
    format(fn: (data: TData) => string) {
      const next = clone(state, { format: fn });
      return makeErrorBuilder(next);
    },
    meta<TNewMeta extends IErrorMeta>(m: TNewMeta) {
      const next = clone(state, { meta: m });
      return makeErrorBuilder(next);
    },
    build() {
      return defineError<TData>({
        id: state.id,
        serialize: state.serialize,
        parse: state.parse,
        dataSchema: state.dataSchema,
        format: state.format,
        meta: state.meta,
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
    meta: {} as IErrorMeta,
  });
  return makeErrorBuilder(initial);
}

export const error = errorBuilder;
