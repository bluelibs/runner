import type { ITagMeta, IValidationSchema } from "../../../defs";
import { symbolFilePath } from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import { defineTag } from "../../defineTag";
import type { TagFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import { clone } from "./utils";

/**
 * Creates a TagFluentBuilder from the given state.
 */
export function makeTagBuilder<TConfig, TEnforceIn, TEnforceOut>(
  state: BuilderState<TConfig, TEnforceIn, TEnforceOut>,
): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut> {
  const builder: TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut> = {
    id: state.id,

    meta(m: ITagMeta) {
      const next = clone(state, { meta: m });
      return makeTagBuilder(next);
    },

    configSchema<TNewConfig>(schema: IValidationSchema<TNewConfig>) {
      const next = clone(state, {
        configSchema: schema,
      }) as BuilderState<TNewConfig, TEnforceIn, TEnforceOut>;
      return makeTagBuilder(next);
    },

    schema<TNewConfig>(schema: IValidationSchema<TNewConfig>) {
      return builder.configSchema(schema);
    },

    config<TNewConfig>(config: TNewConfig) {
      const next = clone(state, { config }) as BuilderState<
        TNewConfig,
        TEnforceIn,
        TEnforceOut
      >;
      return makeTagBuilder(next);
    },

    build() {
      const tag = defineTag<TConfig, TEnforceIn, TEnforceOut>({
        id: state.id,
        meta: state.meta,
        configSchema: state.configSchema as IValidationSchema<TConfig>,
        config: state.config as TConfig,
      });
      (tag as { [symbolFilePath]?: string })[symbolFilePath] = state.filePath;
      return deepFreeze(tag);
    },
  };

  return builder;
}
