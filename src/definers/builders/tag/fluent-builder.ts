import type { ITagMeta, IValidationSchema, TagTarget } from "../../../defs";
import { symbolFilePath } from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import { defineTag } from "../../defineTag";
import type { TagFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import { clone } from "./utils";

/**
 * Creates a TagFluentBuilder from the given state.
 */
export function makeTagBuilder<
  TConfig,
  TEnforceIn,
  TEnforceOut,
  TAllowedTargets extends TagTarget | void = void,
>(
  state: BuilderState<TConfig, TEnforceIn, TEnforceOut, TAllowedTargets>,
): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut, TAllowedTargets> {
  const builder: TagFluentBuilder<
    TConfig,
    TEnforceIn,
    TEnforceOut,
    TAllowedTargets
  > = {
    id: state.id,

    meta(m: ITagMeta) {
      const next = clone(state, { meta: m });
      return makeTagBuilder(next);
    },

    configSchema<TNewConfig>(schema: IValidationSchema<TNewConfig>) {
      const next = clone(state, {
        configSchema: schema,
      }) as BuilderState<TNewConfig, TEnforceIn, TEnforceOut, TAllowedTargets>;
      return makeTagBuilder(next);
    },

    schema<TNewConfig>(schema: IValidationSchema<TNewConfig>) {
      return builder.configSchema(schema);
    },

    config<TNewConfig>(config: TNewConfig) {
      const next = clone(state, { config }) as BuilderState<
        TNewConfig,
        TEnforceIn,
        TEnforceOut,
        TAllowedTargets
      >;
      return makeTagBuilder(next);
    },

    for<const TNewTargets extends readonly [TagTarget, ...TagTarget[]]>(
      targets: TNewTargets,
    ) {
      const next = clone<
        TConfig,
        TEnforceIn,
        TEnforceOut,
        TAllowedTargets,
        TConfig,
        TNewTargets[number]
      >(state, {
        // Store a frozen copy so configured tags inherit an immutable contract.
        targets: Object.freeze([...targets]),
      });
      return makeTagBuilder(next);
    },

    build() {
      const tag = defineTag<TConfig, TEnforceIn, TEnforceOut, TAllowedTargets>({
        id: state.id,
        meta: state.meta,
        configSchema: state.configSchema as IValidationSchema<TConfig>,
        config: state.config as TConfig,
        targets: state.targets,
      });
      return deepFreeze({
        ...tag,
        [symbolFilePath]: state.filePath,
      });
    },
  };

  return builder;
}
