import { getCallerFile } from "../../../tools/getCallerFile";
import { makeTagBuilder } from "./fluent-builder";
import type { TagFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";

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
>(id: string): TagFluentBuilder<TConfig, TEnforceIn, TEnforceOut> {
  const filePath = getCallerFile();
  const initial: BuilderState<TConfig, TEnforceIn, TEnforceOut> = Object.freeze(
    {
      id,
      filePath,
      meta: {} as any,
      configSchema: undefined as any,
      config: undefined as any,
    },
  );

  return makeTagBuilder(initial);
}

export const tag = tagBuilder;
