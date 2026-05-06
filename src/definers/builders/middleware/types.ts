import type {
  DependencyMapType,
  IMiddlewareMeta,
  ResourceMiddlewareTagType,
  TaskMiddlewareTagType,
  ITaskMiddlewareDefinition,
  IResourceMiddlewareDefinition,
  JournalKeyBag,
  ValidationSchemaInput,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";

export type MergeBuilderObjects<TExisting, TNew> = Omit<TExisting, keyof TNew> &
  TNew;

/**
 * Internal state for the TaskMiddlewareFluentBuilder.
 */
export type TaskMwState<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TTags extends TaskMiddlewareTagType[],
  TJournalKeys extends JournalKeyBag,
> = Readonly<{
  id: string;
  dependencies: D | ((config: C) => D);
  configSchema: ValidationSchemaInput<C> | undefined;
  journal: TJournalKeys;
  run:
    | ITaskMiddlewareDefinition<any, In, Out, any, TTags, TJournalKeys>["run"]
    | undefined;
  meta: IMiddlewareMeta;
  tags: TTags;
  filePath: string;
  /** Declarative error contract. */
  throws?: ThrowsList;
}>;

/** Any task-middleware builder state. */
export type AnyTaskMwState = TaskMwState<
  any,
  any,
  any,
  DependencyMapType,
  TaskMiddlewareTagType[],
  JournalKeyBag
>;

/** Replaces the config type for a task-middleware builder state. */
export type ReplaceTaskMwStateConfig<
  TState extends AnyTaskMwState,
  TNextConfig,
> =
  TState extends TaskMwState<
    any,
    infer In,
    infer Out,
    infer D,
    infer TTags,
    infer TJournalKeys
  >
    ? TaskMwState<TNextConfig, In, Out, D, TTags, TJournalKeys>
    : never;

/** Replaces the dependency map type for a task-middleware builder state. */
export type ReplaceTaskMwStateDeps<
  TState extends AnyTaskMwState,
  TNextDeps extends DependencyMapType,
> =
  TState extends TaskMwState<
    infer C,
    infer In,
    infer Out,
    any,
    infer TTags,
    infer TJournalKeys
  >
    ? TaskMwState<C, In, Out, TNextDeps, TTags, TJournalKeys>
    : never;

/** Replaces the tag list type for a task-middleware builder state. */
export type ReplaceTaskMwStateTags<
  TState extends AnyTaskMwState,
  TNextTags extends TaskMiddlewareTagType[],
> =
  TState extends TaskMwState<
    infer C,
    infer In,
    infer Out,
    infer D,
    any,
    infer TJournalKeys
  >
    ? TaskMwState<C, In, Out, D, TNextTags, TJournalKeys>
    : never;

/** Replaces the journal key bag type for a task-middleware builder state. */
export type ReplaceTaskMwStateJournal<
  TState extends AnyTaskMwState,
  TNextJournalKeys extends JournalKeyBag,
> =
  TState extends TaskMwState<
    infer C,
    infer In,
    infer Out,
    infer D,
    infer TTags,
    any
  >
    ? TaskMwState<C, In, Out, D, TTags, TNextJournalKeys>
    : never;

/**
 * Internal state for the ResourceMiddlewareFluentBuilder.
 */
export type ResMwState<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TTags extends ResourceMiddlewareTagType[],
> = Readonly<{
  id: string;
  dependencies: D | ((config: C) => D);
  configSchema: ValidationSchemaInput<C> | undefined;
  run:
    | IResourceMiddlewareDefinition<any, In, Out, any, TTags>["run"]
    | undefined;
  meta: IMiddlewareMeta;
  tags: TTags;
  filePath: string;
  /** Declarative error contract. */
  throws?: ThrowsList;
}>;

/** Any resource-middleware builder state. */
export type AnyResMwState = ResMwState<
  any,
  any,
  any,
  DependencyMapType,
  ResourceMiddlewareTagType[]
>;

/** Replaces the config type for a resource-middleware builder state. */
export type ReplaceResMwStateConfig<TState extends AnyResMwState, TNextConfig> =
  TState extends ResMwState<any, infer In, infer Out, infer D, infer TTags>
    ? ResMwState<TNextConfig, In, Out, D, TTags>
    : never;

/** Replaces the dependency map type for a resource-middleware builder state. */
export type ReplaceResMwStateDeps<
  TState extends AnyResMwState,
  TNextDeps extends DependencyMapType,
> =
  TState extends ResMwState<infer C, infer In, infer Out, any, infer TTags>
    ? ResMwState<C, In, Out, TNextDeps, TTags>
    : never;

/** Replaces the tag list type for a resource-middleware builder state. */
export type ReplaceResMwStateTags<
  TState extends AnyResMwState,
  TNextTags extends ResourceMiddlewareTagType[],
> =
  TState extends ResMwState<infer C, infer In, infer Out, infer D, any>
    ? ResMwState<C, In, Out, D, TNextTags>
    : never;
