import type {
  DependencyMapType,
  IEventDefinition,
  IHookDefinition,
  ITaskMeta,
} from "../../../defs";

/**
 * Internal state for the HookFluentBuilder.
 * Kept immutable and frozen.
 */
export type BuilderState<
  TDeps extends DependencyMapType,
  TOn extends "*" | IEventDefinition<any> | readonly IEventDefinition<any>[],
  TMeta extends ITaskMeta,
> = Readonly<
  Required<
    Pick<
      IHookDefinition<TDeps, TOn, TMeta>,
      "id" | "dependencies" | "on" | "order" | "meta" | "run" | "tags"
    >
  > & {
    filePath: string;
  }
>;
