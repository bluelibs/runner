import type {
  DependencyMapType,
  IEventDefinition,
  IHook,
  IHookDefinition,
  ITaskMeta,
  TagType,
} from "../../defs";
import { symbolFilePath } from "../../defs";
import { defineHook } from "../defineHook";
import { mergeArray } from "./utils";
import { getCallerFile } from "../../tools/getCallerFile";

type BuilderState<
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

function clone<
  TDeps extends DependencyMapType,
  TOn extends "*" | IEventDefinition<any> | readonly IEventDefinition<any>[],
  TMeta extends ITaskMeta,
>(
  s: BuilderState<TDeps, TOn, TMeta>,
  patch: Partial<BuilderState<TDeps, TOn, TMeta>>,
) {
  return Object.freeze({ ...s, ...patch }) as BuilderState<TDeps, TOn, TMeta>;
}

export interface HookFluentBuilder<
  TDeps extends DependencyMapType = {},
  TOn extends
    | "*"
    | IEventDefinition<any>
    | readonly IEventDefinition<any>[] = any,
  TMeta extends ITaskMeta = ITaskMeta,
> {
  id: string;
  on<
    TNewOn extends
      | "*"
      | IEventDefinition<any>
      | readonly IEventDefinition<any>[],
  >(
    on: TNewOn,
  ): HookFluentBuilder<TDeps, TNewOn, TMeta>;
  order(order: number): HookFluentBuilder<TDeps, TOn, TMeta>;
  // Append signature (default)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options?: { override?: false },
  ): HookFluentBuilder<TDeps & TNewDeps, TOn, TMeta>;
  // Override signature (replace)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | (() => TNewDeps),
    options: { override: true },
  ): HookFluentBuilder<TNewDeps, TOn, TMeta>;
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
    options?: { override?: boolean },
  ): HookFluentBuilder<TDeps, TOn, TMeta>;
  meta<TNewMeta extends ITaskMeta>(
    m: TNewMeta,
  ): HookFluentBuilder<TDeps, TOn, TNewMeta>;
  run(
    fn: IHookDefinition<TDeps, TOn, TMeta>["run"],
  ): HookFluentBuilder<TDeps, TOn, TMeta>;
  build(): IHook<TDeps, TOn, TMeta>;
}

function makeHookBuilder<
  TDeps extends DependencyMapType,
  TOn extends "*" | IEventDefinition<any> | readonly IEventDefinition<any>[],
  TMeta extends ITaskMeta,
>(
  state: BuilderState<TDeps, TOn, TMeta>,
): HookFluentBuilder<TDeps, TOn, TMeta> {
  const b: HookFluentBuilder<any, any, any> = {
    id: state.id,
    on<
      TNewOn extends
        | "*"
        | IEventDefinition<any>
        | readonly IEventDefinition<any>[],
    >(on: TNewOn) {
      const next = clone(state, { on: on as any });
      return makeHookBuilder<TDeps, TNewOn, TMeta>(
        next as unknown as BuilderState<TDeps, TNewOn, TMeta>,
      );
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
      const isFnExisting = typeof state.dependencies === "function";
      const isFnAddition = typeof deps === "function";

      let merged: any;
      if (override || !state.dependencies) {
        merged = deps as any;
      } else if (isFnExisting && isFnAddition) {
        const e = state.dependencies as () => TDeps;
        const a = deps as () => TNewDeps;
        merged = (() => ({ ...(e() as any), ...(a() as any) })) as any;
      } else if (isFnExisting && !isFnAddition) {
        const e = state.dependencies as () => TDeps;
        const a = deps as TNewDeps;
        merged = (() => ({ ...(e() as any), ...(a as any) })) as any;
      } else if (!isFnExisting && isFnAddition) {
        const e = state.dependencies as TDeps;
        const a = deps as () => TNewDeps;
        merged = (() => ({ ...(e as any), ...(a() as any) })) as any;
      } else {
        const e = state.dependencies as TDeps;
        const a = deps as TNewDeps;
        merged = ({ ...(e as any), ...(a as any) }) as any;
      }

      const next = clone(state, { dependencies: merged });
      if (override) {
        return makeHookBuilder<TNewDeps, TOn, TMeta>(
          next as unknown as BuilderState<TNewDeps, TOn, TMeta>,
        );
      }
      return makeHookBuilder<TDeps & TNewDeps, TOn, TMeta>(
        next as unknown as BuilderState<TDeps & TNewDeps, TOn, TMeta>,
      );
    },
    tags<TNewTags extends TagType[]>(t: TNewTags, options?: { override?: boolean }) {
      const override = options?.override ?? false;
      const tags = mergeArray(state.tags as any, t as any, override);
      const next = clone(state, { tags: tags as any });
      return makeHookBuilder<TDeps, TOn, TMeta>(next);
    },
    meta<TNewMeta extends ITaskMeta>(m: TNewMeta) {
      const next = clone(state, { meta: m as any });
      return makeHookBuilder<TDeps, TOn, TNewMeta>(
        next as unknown as BuilderState<TDeps, TOn, TNewMeta>,
      );
    },
    run(fn) {
      const next = clone(state, { run: fn as any });
      return makeHookBuilder<TDeps, TOn, TMeta>(next);
    },
    build() {
      const hook = defineHook({
        ...(state as unknown as IHookDefinition<TDeps, TOn, TMeta>),
      });
      (hook as any)[symbolFilePath] = state.filePath;
      return hook;
    },
  };
  return b as HookFluentBuilder<TDeps, TOn, TMeta>;
}

export function hookBuilder(id: string): HookFluentBuilder<{}, any, ITaskMeta> {
  const filePath = getCallerFile();
  const initial: BuilderState<{}, any, ITaskMeta> = Object.freeze({
    id,
    filePath,
    dependencies: {} as any,
    on: "*" as any,
    order: undefined as any,
    meta: {} as any,
    run: undefined as any,
    tags: [] as any,
  });
  return makeHookBuilder(initial);
}

export const hook = hookBuilder;
