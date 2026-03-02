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
 * Entry point for creating a task builder.
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

export const task = taskBuilder;
