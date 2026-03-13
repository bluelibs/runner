import type {
  ITaskMeta,
  TaskTagType,
  TaskMiddlewareAttachmentType,
} from "../../../defs";
import { getCallerFile } from "../../../tools/getCallerFile";
import { makeTaskBuilder } from "./fluent-builder";
import type { TaskFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";

export * from "./fluent-builder.interface";
export * from "./fluent-builder";
export * from "./types";

/**
 * Creates a fluent task builder.
 *
 * Use this when you want the chained builder surface instead of defining a task object directly.
 */
export function taskBuilder<TInput = undefined>(
  id: string,
): TaskFluentBuilder<
  TInput,
  Promise<any>,
  {},
  ITaskMeta,
  TaskTagType[],
  TaskMiddlewareAttachmentType[]
> {
  const filePath = getCallerFile();
  const initial: BuilderState<
    TInput,
    Promise<any>,
    {},
    ITaskMeta,
    TaskTagType[],
    TaskMiddlewareAttachmentType[]
  > = Object.freeze({
    id,
    filePath,
    dependencies: {} as {},
    middleware: [] as TaskMiddlewareAttachmentType[],
    meta: {} as ITaskMeta,
    tags: [] as TaskTagType[],
  });

  return makeTaskBuilder(initial);
}

/**
 * Shorthand for {@link taskBuilder}.
 */
export const task = taskBuilder;
