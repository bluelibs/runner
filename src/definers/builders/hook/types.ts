import type {
  DependencyMapType,
  IEventDefinition,
  IHookDefinition,
  ITaskMeta,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";

/**
 * Internal state for the HookFluentBuilder.
 * Kept immutable and frozen.
 * Note: `on` and `run` can be undefined during building,
 * but are validated as required in build().
 */
export type BuilderState<
  TDeps extends DependencyMapType,
  TOn extends
    | "*"
    | IEventDefinition<any>
    | readonly IEventDefinition<any>[]
    | undefined,
  TMeta extends ITaskMeta,
> = Readonly<
  Omit<
    Required<
      Pick<
        IHookDefinition<TDeps, NonNullable<TOn>, TMeta>,
        "id" | "dependencies" | "order" | "meta" | "tags"
      >
    >,
    never
  > & {
    filePath: string;
    /** Event(s) to listen to. Required before build(). */
    on: TOn;
    /** Hook handler function. Required before build(). */
    run: IHookDefinition<TDeps, NonNullable<TOn>, TMeta>["run"] | undefined;
    /** Declarative error contract. */
    throws?: ThrowsList;
  }
>;
