import type {
  DependencyMapType,
  ITaskMeta,
  TaskTagType,
  TaskMiddlewareAttachmentType,
  ValidationSchemaInput,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";

export type ShouldReplaceInput<T> = [T] extends [undefined]
  ? true
  : [T] extends [void]
    ? true
    : 0 extends 1 & T
      ? true
      : false;

export type ResolveInput<TExisting, TProposed> =
  ShouldReplaceInput<TExisting> extends true ? TProposed : TExisting;

/**
 * Internal state for the TaskFluentBuilder.
 * Kept immutable and frozen.
 */
export type BuilderState<
  _TInput,
  _TOutput,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TaskTagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
> = Readonly<{
  id: string;
  filePath: string;
  dependencies?: TDeps | (() => TDeps);
  middleware?: TMiddleware;
  meta?: TMeta;
  inputSchema?: ValidationSchemaInput<any>;
  resultSchema?: ValidationSchemaInput<any>;
  throws?: ThrowsList;
  run?: (input: unknown, dependencies: unknown) => unknown;
  tags?: TTags;
}>;
