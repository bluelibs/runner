import { getCallerFile } from "../../../tools/getCallerFile";
import { makeTagBuilder } from "./fluent-builder";
import type { TagFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import type { TagTarget } from "../../../defs";

export * from "./fluent-builder.interface";
export * from "./fluent-builder";
export * from "./types";
export * from "./utils";

/**
 * Entry point for creating a tag builder.
 */
export function tagBuilder<
  TConfig = void,
  TEnforceIn = void,
  TEnforceOut = void,
  TAllowedTargets extends TagTarget | void = void,
>(
  id: string,
): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut, TAllowedTargets> {
  const filePath = getCallerFile();
  const initial: BuilderState<
    TConfig,
    TEnforceIn,
    TEnforceOut,
    TAllowedTargets
  > = Object.freeze({
    id,
    filePath,
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

export const tag = tagBuilder;
