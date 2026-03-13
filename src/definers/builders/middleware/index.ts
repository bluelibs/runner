import type {
  DependencyMapType,
  IMiddlewareMeta,
  ResourceMiddlewareTagType,
  TaskMiddlewareTagType,
} from "../../../defs";
import { getCallerFile } from "../../../tools/getCallerFile";
import { makeTaskMiddlewareBuilder } from "./task";
import type { TaskMiddlewareFluentBuilder } from "./task.interface";
import { makeResourceMiddlewareBuilder } from "./resource";
import type { ResourceMiddlewareFluentBuilder } from "./resource.interface";
import type { TaskMwState, ResMwState } from "./types";

export * from "./task.interface";
export * from "./resource.interface";
export * from "./task";
export * from "./resource";
export * from "./types";
export * from "./utils";

/**
 * Creates a fluent task-middleware builder.
 */
export function taskMiddlewareBuilder<C = void>(
  id: string,
): TaskMiddlewareFluentBuilder<C, void, void, {}>;

export function taskMiddlewareBuilder<
  C,
  In,
  Out = void,
  D extends DependencyMapType = {},
>(id: string): TaskMiddlewareFluentBuilder<C, In, Out, D>;

export function taskMiddlewareBuilder<
  C = void,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
>(id: string): TaskMiddlewareFluentBuilder<C, In, Out, D> {
  const filePath = getCallerFile();
  const initial: TaskMwState<C, In, Out, D> = Object.freeze({
    id,
    filePath,
    dependencies: {} as D,
    configSchema: undefined,
    run: undefined,
    meta: {} as IMiddlewareMeta,
    tags: [] as TaskMiddlewareTagType[],
    throws: undefined,
  });

  return makeTaskMiddlewareBuilder(initial);
}

/**
 * Creates a fluent resource-middleware builder.
 */
export function resourceMiddlewareBuilder<C = void>(
  id: string,
): ResourceMiddlewareFluentBuilder<C, void, void, {}>;

export function resourceMiddlewareBuilder<
  C,
  In,
  Out = void,
  D extends DependencyMapType = {},
>(id: string): ResourceMiddlewareFluentBuilder<C, In, Out, D>;

export function resourceMiddlewareBuilder<
  C = void,
  In = void,
  Out = void,
  D extends DependencyMapType = {},
>(id: string): ResourceMiddlewareFluentBuilder<C, In, Out, D> {
  const filePath = getCallerFile();
  const initial: ResMwState<C, In, Out, D> = Object.freeze({
    id,
    filePath,
    dependencies: {} as D,
    configSchema: undefined,
    run: undefined,
    meta: {} as IMiddlewareMeta,
    tags: [] as ResourceMiddlewareTagType[],
    throws: undefined,
  });

  return makeResourceMiddlewareBuilder(initial);
}

/**
 * Shorthand for {@link taskMiddlewareBuilder}.
 */
export const taskMiddleware = taskMiddlewareBuilder;
/**
 * Shorthand for {@link resourceMiddlewareBuilder}.
 */
export const resourceMiddleware = resourceMiddlewareBuilder;
