import type { ITag, ITagMeta, IValidationSchema } from "../../../defs";
import { symbolFilePath } from "../../../defs";
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

    meta(m) {
      const next = clone(state, { meta: m as unknown as ITagMeta });
      return makeTagBuilder(next);
    },

    configSchema<TNewConfig>(schema: IValidationSchema<TNewConfig>) {
      const next = clone(state, { configSchema: schema });
      return makeTagBuilder<TNewConfig, TEnforceIn, TEnforceOut>(
        next as unknown as BuilderState<TNewConfig, TEnforceIn, TEnforceOut>,
      );
    },

    config<TNewConfig>(config: TNewConfig) {
      const next = clone(state, { config: config as unknown as TConfig });
      return makeTagBuilder<TNewConfig, TEnforceIn, TEnforceOut>(
        next as unknown as BuilderState<TNewConfig, TEnforceIn, TEnforceOut>,
      );
    },

    build() {
      const tag = defineTag<TConfig, TEnforceIn, TEnforceOut>({
        id: state.id,
        meta: state.meta,
        configSchema: state.configSchema as any,
        config: state.config as any,
      });
      (tag as { [symbolFilePath]?: string })[symbolFilePath] = state.filePath;
      return tag;
    },
  };

  return builder;
}
