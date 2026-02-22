import type {
  DependencyMapType,
  IPhantomTask,
  ITaskMeta,
  IValidationSchema,
  TagType,
  TaskMiddlewareAttachmentType,
} from "../../../defs";
import { symbolFilePath } from "../../../defs";
import { deepFreeze } from "../../../tools/deepFreeze";
import type { ThrowsList } from "../../../types/error";
import { defineTask } from "../../defineTask";
import type { PhantomTaskFluentBuilder } from "./phantom-builder.interface";
import type { PhantomBuilderState } from "./types";
import { clone, mergeArray, mergeDependencies } from "./utils";

/**
 * Creates a PhantomTaskFluentBuilder from the given state.
 * Each builder method returns a new builder with updated state.
 */
export function makePhantomTaskBuilder<
  TInput,
  TResolved,
  TDeps extends DependencyMapType,
  TMeta extends ITaskMeta,
  TTags extends TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[],
>(
  state: PhantomBuilderState<
    TInput,
    TResolved,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  >,
): PhantomTaskFluentBuilder<
  TInput,
  TResolved,
  TDeps,
  TMeta,
  TTags,
  TMiddleware
> {
  // Widen state once so clone() calls with different type args don't need repetitive double-casts.
  // clone() is purely structural — it spreads and freezes — so widening is safe here.
  const anyState = state as PhantomBuilderState<any, any, any, any, any, any>;

  const builder: PhantomTaskFluentBuilder<
    TInput,
    TResolved,
    TDeps,
    TMeta,
    TTags,
    TMiddleware
  > = {
    id: state.id,
    dependencies<TNewDeps extends DependencyMapType>(
      deps: TNewDeps | (() => TNewDeps),
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const nextDependencies = mergeDependencies<TDeps, TNewDeps>(
        state.dependencies as TDeps | (() => TDeps),
        deps,
        override,
      );

      const next = clone<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        TResolved,
        TDeps & TNewDeps,
        TMeta,
        TTags,
        TMiddleware
      >(anyState, {
        dependencies: nextDependencies as TDeps & TNewDeps,
      });

      if (override) {
        return makePhantomTaskBuilder<
          TInput,
          TResolved,
          TNewDeps,
          TMeta,
          TTags,
          TMiddleware
        >(
          next as PhantomBuilderState<
            TInput,
            TResolved,
            TNewDeps,
            TMeta,
            TTags,
            TMiddleware
          >,
        );
      }
      return makePhantomTaskBuilder<
        TInput,
        TResolved,
        TDeps & TNewDeps,
        TMeta,
        TTags,
        TMiddleware
      >(next);
    },

    middleware<TNewMw extends TaskMiddlewareAttachmentType[]>(
      mw: TNewMw,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = clone<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TNewMw
      >(anyState, {
        middleware: mergeArray(state.middleware, mw, override) as TNewMw,
      });
      return makePhantomTaskBuilder<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TNewMw
      >(next);
    },

    tags<TNewTags extends TagType[]>(
      t: TNewTags,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = clone<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        TResolved,
        TDeps,
        TMeta,
        [...TTags, ...TNewTags],
        TMiddleware
      >(anyState, {
        tags: mergeArray(state.tags, t, override) as [...TTags, ...TNewTags],
      });
      return makePhantomTaskBuilder<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        [...TTags, ...TNewTags],
        TMiddleware
      >(next);
    },

    inputSchema<TNewInput>(schema: IValidationSchema<TNewInput>) {
      const next = clone<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TNewInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(anyState, {
        inputSchema: schema,
      });
      return makePhantomTaskBuilder<
        TNewInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(next);
    },

    resultSchema<TNewResolved>(schema: IValidationSchema<TNewResolved>) {
      const next = clone<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        TNewResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(anyState, {
        resultSchema: schema,
      });
      return makePhantomTaskBuilder<
        TInput,
        TNewResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(next);
    },

    meta<TNewMeta extends ITaskMeta>(m: TNewMeta) {
      const next = clone<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware,
        TInput,
        TResolved,
        TDeps,
        TNewMeta,
        TTags,
        TMiddleware
      >(anyState, {
        meta: m,
      });
      return makePhantomTaskBuilder<
        TInput,
        TResolved,
        TDeps,
        TNewMeta,
        TTags,
        TMiddleware
      >(next);
    },

    throws(list: ThrowsList) {
      const next = clone(anyState, { throws: list });
      return makePhantomTaskBuilder<
        TInput,
        TResolved,
        TDeps,
        TMeta,
        TTags,
        TMiddleware
      >(next);
    },

    build() {
      const built = defineTask.phantom({
        id: state.id,
        dependencies: state.dependencies,
        middleware: state.middleware,
        inputSchema: state.inputSchema,
        resultSchema: state.resultSchema,
        throws: state.throws,
        meta: state.meta,
        tags: state.tags,
      });

      (built as { [symbolFilePath]?: string })[symbolFilePath] = state.filePath;
      return deepFreeze(
        built as IPhantomTask<
          TInput,
          TResolved,
          TDeps,
          TMeta,
          TTags,
          TMiddleware
        >,
      );
    },
  };
  return builder;
}
