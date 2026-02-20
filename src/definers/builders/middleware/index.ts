import type {
  DependencyMapType,
  IMiddlewareMeta,
  TagType,
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
 * Entry point for creating a task middleware builder.
 */
export function taskMiddlewareBuilder<In = void>(
  id: string,
): TaskMiddlewareFluentBuilder<void, In, void, {}>;

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
    tags: [] as TagType[],
    everywhere: undefined,
    throws: undefined,
  });

  return makeTaskMiddlewareBuilder(initial);
}

/**
 * Entry point for creating a resource middleware builder.
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
    tags: [] as TagType[],
    everywhere: undefined,
    throws: undefined,
  });

  return makeResourceMiddlewareBuilder(initial);
}

export const taskMiddleware = taskMiddlewareBuilder;
export const resourceMiddleware = resourceMiddlewareBuilder;
