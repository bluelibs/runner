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
 */
export function hookBuilder(id: string): HookFluentBuilder<{}, any, ITaskMeta> {
  const filePath = getCallerFile();
  const initial: BuilderState<{}, any, ITaskMeta> = Object.freeze({
    id,
    filePath,
    dependencies: {} as {},
    on: "*" as any,
    order: undefined as any,
    meta: {} as ITaskMeta,
    run: undefined as any,
    tags: [] as TagType[],
  });

  return makeHookBuilder(initial);
}

export const hook = hookBuilder;
