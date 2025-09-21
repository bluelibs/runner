import type {
  DependencyMapType,
  ITaskMiddleware,
  ITaskMiddlewareDefinition,
  IResourceMiddleware,
  IResourceMiddlewareDefinition,
  IValidationSchema,
  IMiddlewareMeta,
  TagType,
} from "../../defs";
import { defineTaskMiddleware } from "../defineTaskMiddleware";
import { defineResourceMiddleware } from "../defineResourceMiddleware";

// Task middleware builder
type TaskMwState<C, In, Out, D extends DependencyMapType> = Readonly<
  Required<
    Pick<
      ITaskMiddlewareDefinition<C, In, Out, D>,
      | "id"
      | "dependencies"
      | "configSchema"
      | "run"
      | "meta"
      | "tags"
      | "everywhere"
    >
  >
>;

function cloneTask<C, In, Out, D extends DependencyMapType>(
  s: TaskMwState<C, In, Out, D>,
  patch: Partial<TaskMwState<C, In, Out, D>>,
) {
  return Object.freeze({ ...s, ...patch }) as TaskMwState<C, In, Out, D>;
}

export interface TaskMiddlewareFluentBuilder<
  C = any,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
> {
  id: string;
  // Append signature (default)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: C) => TNewDeps),
    options?: { override?: false },
  ): TaskMiddlewareFluentBuilder<C, In, Out, D & TNewDeps>;
  // Override signature (replace)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: C) => TNewDeps),
    options: { override: true },
  ): TaskMiddlewareFluentBuilder<C, In, Out, TNewDeps>;
  configSchema<TNew>(
    schema: IValidationSchema<TNew>,
  ): TaskMiddlewareFluentBuilder<TNew, In, Out, D>;
  run(
    fn: ITaskMiddlewareDefinition<C, In, Out, D>["run"],
  ): TaskMiddlewareFluentBuilder<C, In, Out, D>;
  meta<TNewMeta extends IMiddlewareMeta>(
    m: TNewMeta,
  ): TaskMiddlewareFluentBuilder<C, In, Out, D>;
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
  ): TaskMiddlewareFluentBuilder<C, In, Out, D>;
  everywhere(
    flag: boolean | ((task: any) => boolean),
  ): TaskMiddlewareFluentBuilder<C, In, Out, D>;
  build(): ITaskMiddleware<C, In, Out, D>;
}

function makeTaskMiddlewareBuilder<C, In, Out, D extends DependencyMapType>(
  state: TaskMwState<C, In, Out, D>,
): TaskMiddlewareFluentBuilder<C, In, Out, D> {
  const b: TaskMiddlewareFluentBuilder<any, any, any, any> = {
    id: state.id,
    dependencies<TNewDeps extends DependencyMapType>(
      deps: TNewDeps | ((config: C) => TNewDeps),
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const isFnExisting = typeof state.dependencies === "function";
      const isFnAddition = typeof deps === "function";

      let merged: any;
      if (override || !state.dependencies) {
        merged = deps as any;
      } else if (isFnExisting && isFnAddition) {
        const e = state.dependencies as (cfg: C) => D;
        const a = deps as (cfg: C) => TNewDeps;
        merged = ((cfg: C) => ({ ...(e(cfg) as any), ...(a(cfg) as any) })) as any;
      } else if (isFnExisting && !isFnAddition) {
        const e = state.dependencies as (cfg: C) => D;
        const a = deps as TNewDeps;
        merged = ((cfg: C) => ({ ...(e(cfg) as any), ...(a as any) })) as any;
      } else if (!isFnExisting && isFnAddition) {
        const e = state.dependencies as D;
        const a = deps as (cfg: C) => TNewDeps;
        merged = ((cfg: C) => ({ ...(e as any), ...(a(cfg) as any) })) as any;
      } else {
        const e = state.dependencies as D;
        const a = deps as TNewDeps;
        merged = ({ ...(e as any), ...(a as any) }) as any;
      }

      const next = cloneTask(state, { dependencies: merged });
      if (override) {
        return makeTaskMiddlewareBuilder<C, In, Out, TNewDeps>(
          next as unknown as TaskMwState<C, In, Out, TNewDeps>,
        );
      }
      return makeTaskMiddlewareBuilder<C, In, Out, D & TNewDeps>(
        next as unknown as TaskMwState<C, In, Out, D & TNewDeps>,
      );
    },
    configSchema<TNew>(schema: IValidationSchema<TNew>) {
      const next = cloneTask(state, { configSchema: schema as any });
      return makeTaskMiddlewareBuilder<TNew, In, Out, D>(
        next as unknown as TaskMwState<TNew, In, Out, D>,
      );
    },
    run(fn) {
      const next = cloneTask(state, { run: fn as any });
      return makeTaskMiddlewareBuilder<C, In, Out, D>(next);
    },
    meta<TNewMeta extends IMiddlewareMeta>(m: TNewMeta) {
      const next = cloneTask(state, { meta: m as any });
      return makeTaskMiddlewareBuilder<C, In, Out, D>(next);
    },
    tags<TNewTags extends TagType[]>(t: TNewTags) {
      const next = cloneTask(state, { tags: t as any });
      return makeTaskMiddlewareBuilder<C, In, Out, D>(next);
    },
    everywhere(flag) {
      const next = cloneTask(state, { everywhere: flag as any });
      return makeTaskMiddlewareBuilder<C, In, Out, D>(next);
    },
    build() {
      return defineTaskMiddleware({
        ...(state as unknown as ITaskMiddlewareDefinition<C, In, Out, D>),
      });
    },
  };
  return b as TaskMiddlewareFluentBuilder<C, In, Out, D>;
}

export function taskMiddlewareBuilder(
  id: string,
): TaskMiddlewareFluentBuilder<any, void, void, {}> {
  const initial: TaskMwState<any, void, void, {}> = Object.freeze({
    id,
    dependencies: {} as any,
    configSchema: undefined as any,
    run: undefined as any,
    meta: {} as any,
    tags: [] as any,
    everywhere: undefined as any,
  });
  return makeTaskMiddlewareBuilder(initial);
}

// Resource middleware builder
type ResMwState<C, In, Out, D extends DependencyMapType> = Readonly<
  Required<
    Pick<
      IResourceMiddlewareDefinition<C, In, Out, D>,
      | "id"
      | "dependencies"
      | "configSchema"
      | "run"
      | "meta"
      | "tags"
      | "everywhere"
    >
  >
>;

function cloneRes<C, In, Out, D extends DependencyMapType>(
  s: ResMwState<C, In, Out, D>,
  patch: Partial<ResMwState<C, In, Out, D>>,
) {
  return Object.freeze({ ...s, ...patch }) as ResMwState<C, In, Out, D>;
}

export interface ResourceMiddlewareFluentBuilder<
  C = any,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
> {
  id: string;
  // Append signature (default)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: C) => TNewDeps),
    options?: { override?: false },
  ): ResourceMiddlewareFluentBuilder<C, In, Out, D & TNewDeps>;
  // Override signature (replace)
  dependencies<TNewDeps extends DependencyMapType>(
    deps: TNewDeps | ((config: C) => TNewDeps),
    options: { override: true },
  ): ResourceMiddlewareFluentBuilder<C, In, Out, TNewDeps>;
  configSchema<TNew>(
    schema: IValidationSchema<TNew>,
  ): ResourceMiddlewareFluentBuilder<TNew, In, Out, D>;
  run(
    fn: IResourceMiddlewareDefinition<C, In, Out, D>["run"],
  ): ResourceMiddlewareFluentBuilder<C, In, Out, D>;
  meta<TNewMeta extends IMiddlewareMeta>(
    m: TNewMeta,
  ): ResourceMiddlewareFluentBuilder<C, In, Out, D>;
  tags<TNewTags extends TagType[]>(
    t: TNewTags,
  ): ResourceMiddlewareFluentBuilder<C, In, Out, D>;
  everywhere(
    flag: boolean | ((resource: any) => boolean),
  ): ResourceMiddlewareFluentBuilder<C, In, Out, D>;
  build(): IResourceMiddleware<C, In, Out, D>;
}

function makeResourceMiddlewareBuilder<C, In, Out, D extends DependencyMapType>(
  state: ResMwState<C, In, Out, D>,
): ResourceMiddlewareFluentBuilder<C, In, Out, D> {
  const b: ResourceMiddlewareFluentBuilder<any, any, any, any> = {
    id: state.id,
    dependencies<TNewDeps extends DependencyMapType>(
      deps: TNewDeps | ((config: C) => TNewDeps),
      options?: { override?: boolean },
    ) {
      const override = options?.override ?? false;
      const isFnExisting = typeof state.dependencies === "function";
      const isFnAddition = typeof deps === "function";

      let merged: any;
      if (override || !state.dependencies) {
        merged = deps as any;
      } else if (isFnExisting && isFnAddition) {
        const e = state.dependencies as (cfg: C) => D;
        const a = deps as (cfg: C) => TNewDeps;
        merged = ((cfg: C) => ({ ...(e(cfg) as any), ...(a(cfg) as any) })) as any;
      } else if (isFnExisting && !isFnAddition) {
        const e = state.dependencies as (cfg: C) => D;
        const a = deps as TNewDeps;
        merged = ((cfg: C) => ({ ...(e(cfg) as any), ...(a as any) })) as any;
      } else if (!isFnExisting && isFnAddition) {
        const e = state.dependencies as D;
        const a = deps as (cfg: C) => TNewDeps;
        merged = ((cfg: C) => ({ ...(e as any), ...(a(cfg) as any) })) as any;
      } else {
        const e = state.dependencies as D;
        const a = deps as TNewDeps;
        merged = ({ ...(e as any), ...(a as any) }) as any;
      }

      const next = cloneRes(state, { dependencies: merged });
      if (override) {
        return makeResourceMiddlewareBuilder<C, In, Out, TNewDeps>(
          next as unknown as ResMwState<C, In, Out, TNewDeps>,
        );
      }
      return makeResourceMiddlewareBuilder<C, In, Out, D & TNewDeps>(
        next as unknown as ResMwState<C, In, Out, D & TNewDeps>,
      );
    },
    configSchema<TNew>(schema: IValidationSchema<TNew>) {
      const next = cloneRes(state, { configSchema: schema as any });
      return makeResourceMiddlewareBuilder<TNew, In, Out, D>(
        next as unknown as ResMwState<TNew, In, Out, D>,
      );
    },
    run(fn) {
      const next = cloneRes(state, { run: fn as any });
      return makeResourceMiddlewareBuilder<C, In, Out, D>(next);
    },
    meta<TNewMeta extends IMiddlewareMeta>(m: TNewMeta) {
      const next = cloneRes(state, { meta: m as any });
      return makeResourceMiddlewareBuilder<C, In, Out, D>(next);
    },
    tags<TNewTags extends TagType[]>(t: TNewTags) {
      const next = cloneRes(state, { tags: t as any });
      return makeResourceMiddlewareBuilder<C, In, Out, D>(next);
    },
    everywhere(flag) {
      const next = cloneRes(state, { everywhere: flag as any });
      return makeResourceMiddlewareBuilder<C, In, Out, D>(next);
    },
    build() {
      return defineResourceMiddleware({
        ...(state as unknown as IResourceMiddlewareDefinition<C, In, Out, D>),
      });
    },
  };
  return b as ResourceMiddlewareFluentBuilder<C, In, Out, D>;
}

export function resourceMiddlewareBuilder(
  id: string,
): ResourceMiddlewareFluentBuilder<any, void, void, {}> {
  const initial: ResMwState<any, void, void, {}> = Object.freeze({
    id,
    dependencies: {} as any,
    configSchema: undefined as any,
    run: undefined as any,
    meta: {} as any,
    tags: [] as any,
    everywhere: undefined as any,
  });
  return makeResourceMiddlewareBuilder(initial);
}

export const taskMiddleware = taskMiddlewareBuilder;
export const resourceMiddleware = resourceMiddlewareBuilder;
