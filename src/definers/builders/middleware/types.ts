import type {
  DependencyMapType,
  IValidationSchema,
  IMiddlewareMeta,
  ResourceMiddlewareTagType,
  TaskMiddlewareTagType,
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
  tags: TaskMiddlewareTagType[];
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
  tags: ResourceMiddlewareTagType[];
  filePath: string;
  /** Declarative error contract. */
  throws?: ThrowsList;
}>;
