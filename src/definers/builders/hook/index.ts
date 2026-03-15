import type { HookTagType, ITaskMeta } from "../../../defs";
import { getCallerFile } from "../../../tools/getCallerFile";
import { makeHookBuilder } from "./fluent-builder";
import type { HookFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";

export * from "./fluent-builder.interface";
export * from "./fluent-builder";
export * from "./types";
export * from "./utils";

/**
 * Creates a fluent hook builder.
 *
 * Hooks must declare both their subscription and their handler before they can be built.
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
    tags: [] as HookTagType[],
    throws: undefined,
  });

  return makeHookBuilder(initial);
}

/**
 * Shorthand for {@link hookBuilder}.
 */
export const hook = hookBuilder;
