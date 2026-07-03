import type {
  DependencyMapType,
  EnsureJournalKeyBag,
  EnsureTagsForTarget,
  ITaskMiddleware,
  ITaskMiddlewareDefinition,
  IMiddlewareMeta,
  JournalKeyBag,
  ResolvedTaskMiddlewareConfig,
  ResolveValidationSchemaInput,
  TaskMiddlewareTagType,
  ValidationSchemaInput,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";
import type { MergeBuilderObjects } from "./types";

export interface TaskMiddlewareFluentBuilderBeforeRun<
  C = any,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
  TTags extends TaskMiddlewareTagType[] = TaskMiddlewareTagType[],
  TJournalKeys extends JournalKeyBag = {},
> {
  id: string;
  /** Adds middleware dependencies, merging by default unless `override: true` is used. */
  dependencies<TNewDeps extends DependencyMapType>(
    deps:
      | TNewDeps
      | ((config: ResolvedTaskMiddlewareConfig<C, TTags>) => TNewDeps),
    options?: { override?: false },
  ): TaskMiddlewareFluentBuilderBeforeRun<
    C,
    In,
    Out,
    D & TNewDeps,
    TTags,
    TJournalKeys
  >;
  /** Replaces previously declared middleware dependencies. */
  dependencies<TNewDeps extends DependencyMapType>(
    deps:
      | TNewDeps
      | ((config: ResolvedTaskMiddlewareConfig<C, TTags>) => TNewDeps),
    options: { override: true },
  ): TaskMiddlewareFluentBuilderBeforeRun<
    C,
    In,
    Out,
    TNewDeps,
    TTags,
    TJournalKeys
  >;
  /** Declares the middleware configuration schema. */
  configSchema<
    TNew = never,
    TSchema extends ValidationSchemaInput<[TNew] extends [never] ? any : TNew> =
      ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
  >(
    schema: TSchema,
  ): TaskMiddlewareFluentBuilderBeforeRun<
    ResolveValidationSchemaInput<TNew, TSchema>,
    In,
    Out,
    D,
    TTags,
    TJournalKeys
  >;

  /**
   * Alias for configSchema. Use this to define the middleware configuration validation contract.
   */
  schema<
    TNew = never,
    TSchema extends ValidationSchemaInput<[TNew] extends [never] ? any : TNew> =
      ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
  >(
    schema: TSchema,
  ): TaskMiddlewareFluentBuilderBeforeRun<
    ResolveValidationSchemaInput<TNew, TSchema>,
    In,
    Out,
    D,
    TTags,
    TJournalKeys
  >;

  /** Declares journal keys exposed by this middleware. */
  journal<TNewJournalKeys extends JournalKeyBag>(
    keys: EnsureJournalKeyBag<TNewJournalKeys>,
    options?: { override?: false },
  ): TaskMiddlewareFluentBuilderBeforeRun<
    C,
    In,
    Out,
    D,
    TTags,
    MergeBuilderObjects<TJournalKeys, TNewJournalKeys>
  >;
  /** Replaces previously declared journal keys. */
  journal<TNewJournalKeys extends JournalKeyBag>(
    keys: EnsureJournalKeyBag<TNewJournalKeys>,
    options: { override: true },
  ): TaskMiddlewareFluentBuilderBeforeRun<
    C,
    In,
    Out,
    D,
    TTags,
    TNewJournalKeys
  >;

  /** Sets the middleware implementation and advances the builder into its post-run phase. */
  run(
    fn: ITaskMiddlewareDefinition<C, In, Out, D, TTags, TJournalKeys>["run"],
  ): TaskMiddlewareFluentBuilderAfterRun<C, In, Out, D, TTags, TJournalKeys>;
  /** Adds middleware tags, merging by default unless `override: true` is used. */
  tags<const TNewTags extends TaskMiddlewareTagType[]>(
    t: EnsureTagsForTarget<"taskMiddlewares", TNewTags>,
    options?: { override?: false },
  ): TaskMiddlewareFluentBuilderBeforeRun<
    C,
    In,
    Out,
    D,
    [...TTags, ...TNewTags],
    TJournalKeys
  >;
  /** Replaces previously declared middleware tags. */
  tags<const TNewTags extends TaskMiddlewareTagType[]>(
    t: EnsureTagsForTarget<"taskMiddlewares", TNewTags>,
    options: { override: true },
  ): TaskMiddlewareFluentBuilderBeforeRun<
    C,
    In,
    Out,
    D,
    TNewTags,
    TJournalKeys
  >;
  /** Attaches metadata used by docs and tooling. */
  meta<TNewMeta extends IMiddlewareMeta>(
    m: TNewMeta,
  ): TaskMiddlewareFluentBuilderBeforeRun<C, In, Out, D, TTags, TJournalKeys>;
  /** Declare which typed errors this middleware may throw (declarative only). */
  throws(
    list: ThrowsList,
  ): TaskMiddlewareFluentBuilderBeforeRun<C, In, Out, D, TTags, TJournalKeys>;
}

export interface TaskMiddlewareFluentBuilderAfterRun<
  C = any,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
  TTags extends TaskMiddlewareTagType[] = TaskMiddlewareTagType[],
  TJournalKeys extends JournalKeyBag = {},
> {
  id: string;
  /** Attaches metadata used by docs and tooling. */
  meta<TNewMeta extends IMiddlewareMeta>(
    m: TNewMeta,
  ): TaskMiddlewareFluentBuilderAfterRun<C, In, Out, D, TTags, TJournalKeys>;
  /** Declare which typed errors this middleware may throw (declarative only). */
  throws(
    list: ThrowsList,
  ): TaskMiddlewareFluentBuilderAfterRun<C, In, Out, D, TTags, TJournalKeys>;
  /** Materializes the final middleware definition for registration or reuse. */
  build(): ITaskMiddleware<C, In, Out, D, TTags, TJournalKeys>;
}

export type TaskMiddlewareFluentBuilder<
  C = any,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
  TTags extends TaskMiddlewareTagType[] = TaskMiddlewareTagType[],
  TJournalKeys extends JournalKeyBag = {},
  THasRun extends boolean = false,
> = THasRun extends true
  ? TaskMiddlewareFluentBuilderAfterRun<C, In, Out, D, TTags, TJournalKeys>
  : TaskMiddlewareFluentBuilderBeforeRun<C, In, Out, D, TTags, TJournalKeys>;
