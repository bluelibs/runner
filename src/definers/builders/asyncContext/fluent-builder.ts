import type { IAsyncContextDefinition, IAsyncContextMeta } from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import { defineAsyncContext } from "../../defineAsyncContext";
import type { AsyncContextFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import { clone } from "./utils";

/**
 * Creates an AsyncContextFluentBuilder from the given state.
 */
export function makeAsyncContextBuilder<T>(
  state: BuilderState<T>,
): AsyncContextFluentBuilder<T> {
  const builder: AsyncContextFluentBuilder<T> = {
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

    schema(schema) {
      return builder.configSchema(schema);
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
      return deepFreeze(defineAsyncContext<T>(def, state.filePath));
    },
  };

  return builder;
}
