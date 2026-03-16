import { getCallerFile } from "../../../tools/getCallerFile";
import { makeTagBuilder } from "./fluent-builder";
import type { TagFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import type { TagTarget } from "../../../defs";

export * from "./fluent-builder.interface";
export * from "./fluent-builder";
export * from "./types";
export * from "./utils";

type InternalTagBuilderOptions = {
  filePath: string;
};

function createTagBuilder<
  TConfig = void,
  TEnforceIn = void,
  TEnforceOut = void,
  TAllowedTargets extends TagTarget | void = void,
>(
  id: string,
  options: InternalTagBuilderOptions,
): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut, TAllowedTargets> {
  const initial: BuilderState<
    TConfig,
    TEnforceIn,
    TEnforceOut,
    TAllowedTargets
  > = Object.freeze({
    id,
    filePath: options.filePath,
    meta: {} as BuilderState<
      TConfig,
      TEnforceIn,
      TEnforceOut,
      TAllowedTargets
    >["meta"],
    configSchema: undefined as BuilderState<
      TConfig,
      TEnforceIn,
      TEnforceOut,
      TAllowedTargets
    >["configSchema"],
    config: undefined as BuilderState<
      TConfig,
      TEnforceIn,
      TEnforceOut,
      TAllowedTargets
    >["config"],
    targets: undefined as BuilderState<
      TConfig,
      TEnforceIn,
      TEnforceOut,
      TAllowedTargets
    >["targets"],
  });

  return makeTagBuilder(initial);
}

/**
 * Creates a fluent tag builder.
 *
 * Tags carry discovery and policy metadata, and this builder keeps target restrictions
 * and config schema close to the declaration.
 */
export function tagBuilder<
  TConfig = void,
  TEnforceIn = void,
  TEnforceOut = void,
  TAllowedTargets extends TagTarget | void = void,
>(
  id: string,
): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut, TAllowedTargets> {
  return createTagBuilder(id, {
    filePath: getCallerFile(),
  });
}

/**
 * Shorthand for {@link tagBuilder}.
 */
export const tag = tagBuilder;
