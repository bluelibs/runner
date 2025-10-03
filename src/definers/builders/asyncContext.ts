import type { IAsyncContextDefinition } from "../../types/asyncContext";
import type { IAsyncContext } from "../../types/asyncContext";
import type { IValidationSchema } from "../../types/utilities";
import { defineAsyncContext } from "../defineAsyncContext";
import type { IAsyncContextMeta } from "../../types/meta";

type BuilderState<T> = Readonly<{
  id: string;
  serialize?: (data: T) => string;
  parse?: (raw: string) => T;
  configSchema?: IValidationSchema<T>;
  meta?: IAsyncContextMeta;
}>;

function clone<T>(s: BuilderState<T>, patch: Partial<BuilderState<T>>) {
  return Object.freeze({ ...s, ...patch }) as BuilderState<T>;
}

export interface AsyncContextFluentBuilder<T = unknown> {
  id: string;
  serialize(fn: (data: T) => string): AsyncContextFluentBuilder<T>;
  parse(fn: (raw: string) => T): AsyncContextFluentBuilder<T>;
  configSchema(schema: IValidationSchema<T>): AsyncContextFluentBuilder<T>;
  meta<TNewMeta extends IAsyncContextMeta>(m: TNewMeta): AsyncContextFluentBuilder<T>;
  build(): IAsyncContext<T>;
}

function makeAsyncContextBuilder<T>(
  state: BuilderState<T>,
): AsyncContextFluentBuilder<T> {
  const b: AsyncContextFluentBuilder<T> = {
    id: state.id,
    serialize(fn) {
      const next = clone(state, { serialize: fn });
      return makeAsyncContextBuilder(next);
    },
    parse(fn) {
      const next = clone(state, { parse: fn });
      return makeAsyncContextBuilder(next);
    },
    configSchema(schema) {
      const next = clone(state, { configSchema: schema });
      return makeAsyncContextBuilder(next);
    },
    meta<TNewMeta extends IAsyncContextMeta>(m: TNewMeta) {
      const next = clone(state, { meta: m });
      return makeAsyncContextBuilder(next);
    },
    build() {
      const def: IAsyncContextDefinition<T> = {
        id: state.id,
        serialize: state.serialize,
        parse: state.parse,
        configSchema: state.configSchema,
        meta: state.meta,
      };
      return defineAsyncContext<T>(def);
    },
  };
  return b;
}

export function asyncContextBuilder<T = unknown>(
  id: string,
): AsyncContextFluentBuilder<T> {
  const initial: BuilderState<T> = Object.freeze({
    id,
    serialize: undefined,
    parse: undefined,
    configSchema: undefined,
    meta: {} as IAsyncContextMeta,
  });
  return makeAsyncContextBuilder(initial);
}

export const asyncContext = asyncContextBuilder;
