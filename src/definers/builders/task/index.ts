import type {
  ITaskMeta,
  TaskTagType,
  TaskMiddlewareAttachmentType,
} from "../../../defs";
import { getCallerFile } from "../../../tools/getCallerFile";
import { makeTaskBuilder } from "./fluent-builder";
import type { TaskFluentBuilder } from "./fluent-builder.interface";
import { makePhantomTaskBuilder } from "./phantom-builder";
import type { PhantomTaskFluentBuilder } from "./phantom-builder.interface";
import type { BuilderState, PhantomBuilderState } from "./types";

export * from "./fluent-builder.interface";
export * from "./fluent-builder";
export * from "./phantom-builder.interface";
export * from "./phantom-builder";
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

/**
 * Entry point for creating a phantom task builder.
 */
export function phantomTaskBuilder<TInput = undefined, TResolved = any>(
  id: string,
): PhantomTaskFluentBuilder<
  TInput,
  TResolved,
  {},
  ITaskMeta,
  TaskTagType[],
  TaskMiddlewareAttachmentType[]
> {
  const filePath = getCallerFile();
  const initial: PhantomBuilderState<
    TInput,
    TResolved,
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

  return makePhantomTaskBuilder(initial);
}

export interface TaskBuilderWithPhantom {
  <TInput = undefined>(
    id: string,
  ): TaskFluentBuilder<
    TInput,
    Promise<any>,
    {},
    ITaskMeta,
    TaskTagType[],
    TaskMiddlewareAttachmentType[]
  >;
  phantom: typeof phantomTaskBuilder;
}

export const task: TaskBuilderWithPhantom = Object.assign(taskBuilder, {
  phantom: phantomTaskBuilder,
});
