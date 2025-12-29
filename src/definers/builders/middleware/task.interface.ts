import type {
  DependencyMapType,
  ITask,
  ITaskMiddleware,
  ITaskMiddlewareDefinition,
  IValidationSchema,
  IMiddlewareMeta,
  TagType,
} from "../../../defs";

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
    options?: { override?: boolean },
  ): TaskMiddlewareFluentBuilder<C, In, Out, D>;
  everywhere(
    flag: boolean | ((task: ITask<any, any, any, any>) => boolean),
  ): TaskMiddlewareFluentBuilder<C, In, Out, D>;
  build(): ITaskMiddleware<C, In, Out, D>;
}
