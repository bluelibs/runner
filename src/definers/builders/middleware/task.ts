import type {
  DependencyMapType,
  EnsureTagsForTarget,
  JournalKeyBag,
  ResolveValidationSchemaInput,
  ITaskMiddlewareDefinition,
  IMiddlewareMeta,
  TaskMiddlewareTagType,
  ValidationSchemaInput,
} from "../../../defs";
import { symbolFilePath } from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import type { ThrowsList } from "../../../types/error";
import { builderIncompleteError } from "../../../errors";
import { defineTaskMiddleware } from "../../defineTaskMiddleware";
import type {
  TaskMiddlewareFluentBuilder,
  TaskMiddlewareFluentBuilderAfterRun,
  TaskMiddlewareFluentBuilderBeforeRun,
} from "./task.interface";
import type {
  MergeBuilderObjects,
  ReplaceTaskMwStateConfig,
  ReplaceTaskMwStateDeps,
  ReplaceTaskMwStateTags,
  TaskMwState,
} from "./types";
import {
  cloneTask,
  cloneTaskWithJournal,
  mergeArray,
  mergeDependencies,
} from "./utils";

/**
 * Creates a TaskMiddlewareFluentBuilder from the given state.
 */
export function makeTaskMiddlewareBuilder<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TTags extends TaskMiddlewareTagType[],
  TJournalKeys extends JournalKeyBag,
  THasRun extends boolean = false,
>(
  state: TaskMwState<C, In, Out, D, TTags, TJournalKeys>,
): TaskMiddlewareFluentBuilder<C, In, Out, D, TTags, TJournalKeys, THasRun> {
  const builder = {
    id: state.id,

    dependencies<TNewDeps extends DependencyMapType>(
      deps: TNewDeps | ((config: C) => TNewDeps),
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const nextDependencies = mergeDependencies<C, D, TNewDeps>(
        state.dependencies as D | ((config: C) => D),
        deps,
        override,
      );

      const next = cloneTask<
        typeof state,
        ReplaceTaskMwStateDeps<typeof state, D & TNewDeps>
      >(state, {
        dependencies: nextDependencies as D & TNewDeps,
      });

      if (override) {
        const overridden = cloneTask<
          typeof next,
          ReplaceTaskMwStateDeps<typeof next, TNewDeps>
        >(next, {
          dependencies: nextDependencies as TNewDeps,
        });
        return makeTaskMiddlewareBuilder<
          C,
          In,
          Out,
          TNewDeps,
          TTags,
          TJournalKeys,
          false
        >(overridden);
      }
      return makeTaskMiddlewareBuilder<
        C,
        In,
        Out,
        D & TNewDeps,
        TTags,
        TJournalKeys,
        false
      >(next);
    },

    configSchema<
      TNew = never,
      TSchema extends ValidationSchemaInput<
        [TNew] extends [never] ? any : TNew
      > = ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
    >(schema: TSchema) {
      const next = cloneTask<
        typeof state,
        ReplaceTaskMwStateConfig<
          typeof state,
          ResolveValidationSchemaInput<TNew, TSchema>
        >
      >(state, {
        configSchema: schema,
      });
      return makeTaskMiddlewareBuilder<
        ResolveValidationSchemaInput<TNew, TSchema>,
        In,
        Out,
        D,
        TTags,
        TJournalKeys,
        false
      >(next);
    },

    schema<
      TNew = never,
      TSchema extends ValidationSchemaInput<
        [TNew] extends [never] ? any : TNew
      > = ValidationSchemaInput<[TNew] extends [never] ? any : TNew>,
    >(schema: TSchema) {
      return builder.configSchema(schema);
    },

    journal<TNewJournalKeys extends JournalKeyBag>(
      journalKeys: TNewJournalKeys,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;

      if (override) {
        return makeTaskMiddlewareBuilder<
          C,
          In,
          Out,
          D,
          TTags,
          TNewJournalKeys,
          false
        >(cloneTaskWithJournal(state, journalKeys));
      }

      const nextJournal = {
        ...state.journal,
        ...journalKeys,
      } as MergeBuilderObjects<TJournalKeys, TNewJournalKeys>;

      const next = cloneTaskWithJournal(state, nextJournal);

      return makeTaskMiddlewareBuilder<
        C,
        In,
        Out,
        D,
        TTags,
        MergeBuilderObjects<TJournalKeys, TNewJournalKeys>,
        false
      >(next);
    },

    run(
      fn: ITaskMiddlewareDefinition<C, In, Out, D, TTags, TJournalKeys>["run"],
    ) {
      const next = cloneTask(state, { run: fn as typeof state.run });
      return makeTaskMiddlewareBuilder<
        C,
        In,
        Out,
        D,
        TTags,
        TJournalKeys,
        true
      >(next);
    },

    meta<TNewMeta extends IMiddlewareMeta>(m: TNewMeta) {
      const next = cloneTask(state, { meta: m as IMiddlewareMeta });
      return makeTaskMiddlewareBuilder<
        C,
        In,
        Out,
        D,
        TTags,
        TJournalKeys,
        THasRun
      >(next);
    },

    tags<TNewTags extends TaskMiddlewareTagType[]>(
      t: EnsureTagsForTarget<"taskMiddlewares", TNewTags>,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      if (override) {
        const nextTags = mergeArray(state.tags, t, true) as TNewTags;
        const next = cloneTask<
          typeof state,
          ReplaceTaskMwStateTags<typeof state, TNewTags>
        >(state, {
          tags: nextTags,
        });
        return makeTaskMiddlewareBuilder<
          C,
          In,
          Out,
          D,
          TNewTags,
          TJournalKeys,
          false
        >(next);
      }

      const nextTags = mergeArray(state.tags, t, false) as [
        ...TTags,
        ...TNewTags,
      ];
      const next = cloneTask<
        typeof state,
        ReplaceTaskMwStateTags<typeof state, [...TTags, ...TNewTags]>
      >(state, {
        tags: nextTags,
      });
      return makeTaskMiddlewareBuilder<
        C,
        In,
        Out,
        D,
        [...TTags, ...TNewTags],
        TJournalKeys,
        false
      >(next);
    },

    throws(list: ThrowsList) {
      const next = cloneTask(state, { throws: list });
      return makeTaskMiddlewareBuilder<
        C,
        In,
        Out,
        D,
        TTags,
        TJournalKeys,
        THasRun
      >(next);
    },

    build() {
      // Fail-fast: validate required fields before creating middleware
      if (state.run === undefined) {
        builderIncompleteError.throw({
          type: "task-middleware",
          builderId: state.id,
          missingFields: ["run"],
          message: `Task middleware "${state.id}" is incomplete`,
        });
      }

      const middleware = defineTaskMiddleware({
        ...(state as ITaskMiddlewareDefinition<
          C,
          In,
          Out,
          D,
          TTags,
          TJournalKeys
        >),
      });
      return deepFreeze({
        ...middleware,
        [symbolFilePath]: state.filePath,
      });
    },
  };

  return builder as unknown as TaskMiddlewareFluentBuilderBeforeRun<
    C,
    In,
    Out,
    D,
    TTags,
    TJournalKeys
  > &
    TaskMiddlewareFluentBuilderAfterRun<C, In, Out, D, TTags, TJournalKeys> &
    TaskMiddlewareFluentBuilder<C, In, Out, D, TTags, TJournalKeys, THasRun>;
}
