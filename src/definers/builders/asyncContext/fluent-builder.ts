import type {
  IAsyncContextDefinition,
  IAsyncContextMeta,
  ResolveValidationSchemaInput,
  ValidationSchemaInput,
} from "../../../defs";
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
  const builder = {
    id: state.id,

    serialize(fn: (data: T) => string) {
      const next = clone(state, { serialize: fn });
      return makeAsyncContextBuilder(next);
    },

    parse(fn: (raw: string) => T) {
      const next = clone(state, { parse: fn });
      return makeAsyncContextBuilder(next);
    },

    configSchema<
      TNew = never,
      TSchema extends ValidationSchemaInput<
        [TNew] extends [never] ? any : TNew
      > = ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
    >(schema: TSchema) {
      const next = clone(state as BuilderState<any>, {
        configSchema: schema,
      }) as BuilderState<ResolveValidationSchemaInput<TNew, TSchema>>;
      return makeAsyncContextBuilder<
        ResolveValidationSchemaInput<TNew, TSchema>
      >(next);
    },

    schema<
      TNew = never,
      TSchema extends ValidationSchemaInput<
        [TNew] extends [never] ? any : TNew
      > = ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
    >(schema: TSchema) {
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

  return builder as AsyncContextFluentBuilder<T>;
}
