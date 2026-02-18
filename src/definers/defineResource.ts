import type {
  IResource,
  IResourceDefinition,
  DependencyMapType,
  IResourceMeta,
  TagType,
  IOptionalDependency,
  ResourceMiddlewareAttachmentType,
  IResourceWithConfig,
  ResourceForkOptions,
} from "../types/resource";
import {
  symbolForkedFrom,
  symbolResource,
  symbolFilePath,
  symbolOptionalDependency,
  symbolResourceWithConfig,
} from "../types/symbols";
import { validationError } from "../errors";
import { getCallerFile } from "../tools/getCallerFile";
import { normalizeThrows } from "../tools/throws";
import { resolveForkedRegisterAndDependencies } from "./resourceFork";

export function defineResource<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TPrivate = any,
  TMeta extends IResourceMeta = any,
  TTags extends TagType[] = TagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] =
    ResourceMiddlewareAttachmentType[],
>(
  constConfig: IResourceDefinition<
    TConfig,
    TValue,
    TDeps,
    TPrivate,
    any,
    any,
    TMeta,
    TTags,
    TMiddleware
  >,
): IResource<TConfig, TValue, TDeps, TPrivate, TMeta, TTags, TMiddleware> {
  /**
   * Define a resource.
   * Produces a strongly-typed resource with id, registration hooks,
   * and optional config schema.
   *
   * - If `id` is omitted, an anonymous, file-based id is generated (resource or index flavored).
   * - Provides `.with(config)` for config-bound registration with optional runtime validation.
   *
   * @typeParam TConfig - Configuration type accepted by the resource.
   * @typeParam TValue - Promise type resolved by the resource `init`.
   * @typeParam TDeps - Dependency map type this resource requires.
   * @typeParam TPrivate - Private context type exposed to middleware during init.
   * @typeParam TMeta - Arbitrary metadata type carried by the resource.
   * @param constConfig - The resource definition config.
   * @returns A branded resource definition usable by the runner.
   */
  const filePath: string = constConfig[symbolFilePath] || getCallerFile();
  const id = constConfig.id;

  const base = {
    [symbolResource]: true,
    [symbolFilePath]: filePath,
    id,
    dependencies: constConfig.dependencies,
    dispose: constConfig.dispose,
    register: constConfig.register || [],
    overrides: constConfig.overrides || [],
    init: constConfig.init,
    context: constConfig.context,
    configSchema: constConfig.configSchema,
    resultSchema: constConfig.resultSchema,
    tags: constConfig.tags ?? [],
    throws: normalizeThrows({ kind: "resource", id }, constConfig.throws),
    meta: (constConfig.meta || {}) as TMeta,
    middleware: constConfig.middleware ?? [],
  } as IResource<TConfig, TValue, TDeps, TPrivate, TMeta, TTags, TMiddleware>;

  const resolveCurrent = (
    candidate: unknown,
  ): IResource<TConfig, TValue, TDeps, TPrivate, TMeta, TTags, TMiddleware> => {
    if (
      candidate &&
      typeof candidate === "object" &&
      symbolResource in candidate
    ) {
      return candidate as IResource<
        TConfig,
        TValue,
        TDeps,
        TPrivate,
        TMeta,
        TTags,
        TMiddleware
      >;
    }
    return base;
  };

  const buildDefinition = (
    current: IResource<
      TConfig,
      TValue,
      TDeps,
      TPrivate,
      TMeta,
      TTags,
      TMiddleware
    >,
  ): IResourceDefinition<
    TConfig,
    TValue,
    TDeps,
    TPrivate,
    any,
    any,
    TMeta,
    TTags,
    TMiddleware
  > => ({
    id: current.id,
    dependencies: current.dependencies,
    register: current.register,
    overrides: current.overrides,
    init: current.init,
    context: current.context,
    configSchema: current.configSchema,
    resultSchema: current.resultSchema,
    tags: current.tags,
    throws: current.throws,
    middleware: current.middleware,
    dispose: current.dispose,
    meta: current.meta,
  });

  base.with = function (config: TConfig) {
    const current = resolveCurrent(this);
    const currentId = current.id;

    // Validate config with schema if provided (fail fast)
    if (current.configSchema) {
      try {
        config = current.configSchema.parse(config);
      } catch (error) {
        validationError.throw({
          subject: "Resource config",
          id: currentId,
          originalError:
            error instanceof Error ? error : new Error(String(error)),
        });
      }
    }

    return {
      [symbolResourceWithConfig]: true,
      id: currentId,
      resource: current,
      config,
    } satisfies IResourceWithConfig<
      TConfig,
      TValue,
      TDeps,
      TPrivate,
      TMeta,
      TTags,
      TMiddleware
    >;
  };

  base.optional = function () {
    const current = resolveCurrent(this);
    return {
      inner: current,
      [symbolOptionalDependency]: true,
    } as IOptionalDependency<
      IResource<TConfig, TValue, TDeps, TPrivate, TMeta, TTags, TMiddleware>
    >;
  };

  base.fork = function (newId: string, options?: ResourceForkOptions) {
    const current = resolveCurrent(this);
    const forkCallerFilePath = getCallerFile();
    const forkedParts = resolveForkedRegisterAndDependencies({
      register: current.register,
      dependencies: current.dependencies,
      forkId: newId,
      options,
    });
    const forked = defineResource({
      ...buildDefinition(current),
      id: newId,
      register: forkedParts.register,
      dependencies: forkedParts.dependencies,
      [symbolFilePath]: forkCallerFilePath,
    });
    forked[symbolForkedFrom] = {
      fromId: current.id,
    };
    return forked;
  };

  return base;
}
