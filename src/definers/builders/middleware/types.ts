import type {
  DependencyMapType,
  IValidationSchema,
  IMiddlewareMeta,
  TagType,
  ITaskMiddlewareDefinition,
  IResourceMiddlewareDefinition,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";

/**
 * Internal state for the TaskMiddlewareFluentBuilder.
 */
export type TaskMwState<C, In, Out, D extends DependencyMapType> = Readonly<{
  id: string;
  dependencies: D | ((config: C) => D);
  configSchema: IValidationSchema<C> | undefined;
  run: ITaskMiddlewareDefinition<any, In, Out, any>["run"] | undefined;
  meta: IMiddlewareMeta;
  tags: TagType[];
  everywhere: ITaskMiddlewareDefinition<C, In, Out, D>["everywhere"];
  filePath: string;
  /** Declarative error contract. */
  throws?: ThrowsList;
}>;

/**
 * Internal state for the ResourceMiddlewareFluentBuilder.
 */
export type ResMwState<C, In, Out, D extends DependencyMapType> = Readonly<{
  id: string;
  dependencies: D | ((config: C) => D);
  configSchema: IValidationSchema<C> | undefined;
  run: IResourceMiddlewareDefinition<any, In, Out, any>["run"] | undefined;
  meta: IMiddlewareMeta;
  tags: TagType[];
  everywhere: IResourceMiddlewareDefinition<C, In, Out, D>["everywhere"];
  filePath: string;
  /** Declarative error contract. */
  throws?: ThrowsList;
}>;
