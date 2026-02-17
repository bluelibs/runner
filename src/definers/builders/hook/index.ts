import type { ITaskMeta, TagType } from "../../../defs";
import { getCallerFile } from "../../../tools/getCallerFile";
import { makeHookBuilder } from "./fluent-builder";
import type { HookFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";

export * from "./fluent-builder.interface";
export * from "./fluent-builder";
export * from "./types";
export * from "./utils";

/**
 * Entry point for creating a hook builder.
 * Requires calling .on() and .run() before .build().
 */
export function hookBuilder(
  id: string,
): HookFluentBuilder<{}, undefined, ITaskMeta> {
  const filePath = getCallerFile();
  const initial: BuilderState<{}, undefined, ITaskMeta> = Object.freeze({
    id,
    filePath,
    dependencies: {} as {},
    on: undefined,
    order: 0,
    meta: {} as ITaskMeta,
    run: undefined,
    tags: [] as TagType[],
    throws: undefined,
  });

  return makeHookBuilder(initial);
}

export const hook = hookBuilder;
