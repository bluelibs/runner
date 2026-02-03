import type {
  DependencyMapType,
  ITaskMiddlewareDefinition,
  IResourceMiddlewareDefinition,
} from "../../../defs";

/**
 * Internal state for the TaskMiddlewareFluentBuilder.
 */
export type TaskMwState<C, In, Out, D extends DependencyMapType> = Readonly<
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
  > & {
    filePath: string;
  }
>;

/**
 * Internal state for the ResourceMiddlewareFluentBuilder.
 */
export type ResMwState<C, In, Out, D extends DependencyMapType> = Readonly<
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
  > & {
    filePath: string;
  }
>;
