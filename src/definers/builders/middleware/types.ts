import type {
  DependencyMapType,
  IMiddlewareMeta,
  ResourceMiddlewareTagType,
  TaskMiddlewareTagType,
  ITaskMiddlewareDefinition,
  IResourceMiddlewareDefinition,
  ValidationSchemaInput,
} from "../../../defs";
import type { ThrowsList } from "../../../types/error";

/**
 * Internal state for the TaskMiddlewareFluentBuilder.
 */
export type TaskMwState<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TTags extends TaskMiddlewareTagType[],
> = Readonly<{
  id: string;
  dependencies: D | ((config: C) => D);
  configSchema: ValidationSchemaInput<C> | undefined;
  run: ITaskMiddlewareDefinition<any, In, Out, any, TTags>["run"] | undefined;
  meta: IMiddlewareMeta;
  tags: TTags;
  filePath: string;
  /** Declarative error contract. */
  throws?: ThrowsList;
}>;

/**
 * Internal state for the ResourceMiddlewareFluentBuilder.
 */
export type ResMwState<
  C,
  In,
  Out,
  D extends DependencyMapType,
  TTags extends ResourceMiddlewareTagType[],
> = Readonly<{
  id: string;
  dependencies: D | ((config: C) => D);
  configSchema: ValidationSchemaInput<C> | undefined;
  run:
    | IResourceMiddlewareDefinition<any, In, Out, any, TTags>["run"]
    | undefined;
  meta: IMiddlewareMeta;
  tags: TTags;
  filePath: string;
  /** Declarative error contract. */
  throws?: ThrowsList;
}>;
