import type {
  DependencyMapType,
  IEventDefinition,
  IHook,
  IHookDefinition,
  ITaskMeta,
  TagType,
} from "../../../defs";
import { symbolFilePath } from "../../../defs";
import type { ThrowsList } from "../../../types/error";
import { builderIncompleteError } from "../../../errors";
import { defineHook } from "../../defineHook";
import type { HookFluentBuilder } from "./fluent-builder.interface";
import type { BuilderState } from "./types";
import { clone, mergeArray, mergeDependencies } from "./utils";

/**
 * Creates a HookFluentBuilder from the given state.
 * Each builder method returns a new builder with updated state.
 */
export function makeHookBuilder<
  TDeps extends DependencyMapType,
  TOn extends
    | "*"
    | IEventDefinition<any>
    | readonly IEventDefinition<any>[]
    | undefined,
  TMeta extends ITaskMeta,
>(
  state: BuilderState<TDeps, TOn, TMeta>,
): HookFluentBuilder<TDeps, TOn, TMeta> {
  const builder: HookFluentBuilder<TDeps, TOn, TMeta> = {
    id: state.id,

    on<
      TNewOn extends
        | "*"
        | IEventDefinition<any>
        | readonly IEventDefinition<any>[],
    >(on: TNewOn) {
      const next = clone<TDeps, TOn, TMeta, TDeps, TNewOn, TMeta>(state, {
        on: on as TNewOn,
      });
      return makeHookBuilder<TDeps, TNewOn, TMeta>(next);
    },

    order(order: number) {
      const next = clone(state, { order });
      return makeHookBuilder<TDeps, TOn, TMeta>(next);
    },

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

      const next = clone<TDeps, TOn, TMeta, TDeps & TNewDeps, TOn, TMeta>(
        state as BuilderState<TDeps, TOn, TMeta>,
        {
          dependencies: nextDependencies as unknown as TDeps & TNewDeps,
        },
      );

      if (override) {
        return makeHookBuilder<TNewDeps, TOn, TMeta>(
          next as unknown as BuilderState<TNewDeps, TOn, TMeta>,
        );
      }
      return makeHookBuilder<TDeps & TNewDeps, TOn, TMeta>(next);
    },

    tags<TNewTags extends TagType[]>(
      t: TNewTags,
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const next = clone(state, {
        tags: mergeArray(state.tags, t, override) as TagType[],
      });
      return makeHookBuilder<TDeps, TOn, TMeta>(next);
    },

    meta<TNewMeta extends ITaskMeta>(m: TNewMeta) {
      const next = clone<TDeps, TOn, TMeta, TDeps, TOn, TNewMeta>(
        state as BuilderState<TDeps, TOn, TMeta>,
        {
          meta: m as TNewMeta,
        },
      );
      return makeHookBuilder<TDeps, TOn, TNewMeta>(next);
    },

    run(fn) {
      const next = clone(state, { run: fn as NonNullable<typeof state.run> });
      return makeHookBuilder<TDeps, TOn, TMeta>(next);
    },

    throws(list: ThrowsList) {
      const next = clone(state, { throws: list });
      return makeHookBuilder<TDeps, TOn, TMeta>(next);
    },

    build() {
      // Fail-fast: validate required fields before creating hook
      const missingFields: string[] = [];
      if (state.on === undefined) {
        missingFields.push("on");
      }
      if (state.run === undefined) {
        missingFields.push("run");
      }
      if (missingFields.length > 0) {
        builderIncompleteError.throw({
          type: "hook",
          builderId: state.id,
          missingFields,
          message: `Hook "${state.id}" is incomplete`,
        });
      }

      const hook = defineHook({
        ...(state as unknown as IHookDefinition<TDeps, any, TMeta>),
      });
      (hook as { [symbolFilePath]?: string })[symbolFilePath] = state.filePath;
      // Runtime validation guarantees TOn is valid
      return hook as IHook<TDeps, any, TMeta>;
    },
  };

  return builder;
}
