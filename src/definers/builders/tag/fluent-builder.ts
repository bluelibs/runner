import type { ITagMeta, TagTarget, ValidationSchemaInput } from "../../../defs";
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

    configSchema<TNewConfig>(schema: ValidationSchemaInput<TNewConfig>) {
      const next = clone(state, {
        configSchema: schema,
      }) as BuilderState<TNewConfig, TEnforceIn, TEnforceOut, TAllowedTargets>;
      return makeTagBuilder(next);
    },

    schema<TNewConfig>(schema: ValidationSchemaInput<TNewConfig>) {
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

    for<
      TNewTargetOrTargets extends
        | TagTarget
        | readonly [TagTarget, ...TagTarget[]],
    >(targetOrTargets: TNewTargetOrTargets) {
      type NextAllowedTargets = TNewTargetOrTargets extends readonly TagTarget[]
        ? TNewTargetOrTargets[number]
        : TNewTargetOrTargets;
      const normalizedTargets = Array.isArray(targetOrTargets)
        ? targetOrTargets
        : [targetOrTargets];
      const next = clone<
        TConfig,
        TEnforceIn,
        TEnforceOut,
        TAllowedTargets,
        TConfig,
        NextAllowedTargets
      >(state, {
        // Store a frozen copy so configured tags inherit an immutable contract.
        targets: Object.freeze([...normalizedTargets]),
      });
      return makeTagBuilder(next) as TagFluentBuilder<
        TConfig,
        TEnforceIn,
        TEnforceOut,
        NextAllowedTargets
      >;
    },

    build() {
      const tag = defineTag<TConfig, TEnforceIn, TEnforceOut, TAllowedTargets>({
        id: state.id,
        meta: state.meta,
        configSchema: state.configSchema,
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
