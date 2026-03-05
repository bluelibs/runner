import type {
  DependencyMapType,
  ITaskMeta,
  TaskTagType,
  TaskMiddlewareAttachmentType,
} from "../../../defs";
import type { BuilderState } from "./types";

/**
 * Clones and patches the builder state immutably.
 */
export function clone<
  TInput,
  TOutput,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TaskTagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
  TNextInput = TInput,
  TNextOutput = TOutput,
  TNextDeps extends DependencyMapType = TDeps,
  TNextMeta extends ITaskMeta = TMeta,
  TNextTags extends TaskTagType[] = TTags,
  TNextMiddleware extends TaskMiddlewareAttachmentType[] = TMiddleware,
>(
  s: BuilderState<TInput, TOutput, TDeps, TMeta, TTags, TMiddleware>,
  patch: Partial<
    BuilderState<
      TNextInput,
      TNextOutput,
      TNextDeps,
      TNextMeta,
      TNextTags,
      TNextMiddleware
    >
  >,
): BuilderState<
  TNextInput,
  TNextOutput,
  TNextDeps,
  TNextMeta,
  TNextTags,
  TNextMiddleware
> {
  type NextState = BuilderState<
    TNextInput,
    TNextOutput,
    TNextDeps,
    TNextMeta,
    TNextTags,
    TNextMiddleware
  >;
  return Object.freeze({
    ...(s as NextState),
    ...patch,
  }) as NextState;
}

export { mergeArray } from "../shared/mergeUtils";
export { mergeDepsNoConfig as mergeDependencies } from "../shared/mergeUtils";
