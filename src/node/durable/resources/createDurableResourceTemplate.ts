import { defineResource } from "../../../definers/defineResource";
import { getCallerFile } from "../../../tools/getCallerFile";
import { deepFreeze } from "../../../tools/deepFreeze";
import type {
  DependencyMapType,
  IResource,
  IResourceMeta,
  ResourceMiddlewareAttachmentType,
  ResourceTagType,
} from "../../../types/resource";
import { symbolFilePath } from "../../../types/symbols";

export type DurableResourceTemplate<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
> = IResource<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware> & {
  define: (
    newId: string,
  ) => IResource<TConfig, TValue, TDeps, TContext, TMeta, TTags, TMiddleware>;
};

export function createDurableResourceTemplate<
  TConfig,
  TValue extends Promise<any>,
  TDeps extends DependencyMapType,
  TContext,
  TMeta extends IResourceMeta,
  TTags extends ResourceTagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[],
>(
  resource: IResource<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >,
): DurableResourceTemplate<
  TConfig,
  TValue,
  TDeps,
  TContext,
  TMeta,
  TTags,
  TMiddleware
> {
  const template = {
    ...resource,
    define(newId: string) {
      return defineResource({
        id: newId,
        dependencies: resource.dependencies,
        register: resource.register,
        overrides: resource.overrides,
        init: resource.init,
        context: resource.context,
        configSchema: resource.configSchema,
        resultSchema: resource.resultSchema,
        tags: resource.tags,
        throws: resource.throws,
        middleware: resource.middleware,
        dispose: resource.dispose,
        ready: resource.ready,
        cooldown: resource.cooldown,
        meta: resource.meta,
        isolate: resource.isolate,
        subtree: resource.subtree,
        gateway: resource.gateway,
        [symbolFilePath]: getCallerFile(),
      });
    },
  } as DurableResourceTemplate<
    TConfig,
    TValue,
    TDeps,
    TContext,
    TMeta,
    TTags,
    TMiddleware
  >;

  return deepFreeze(template);
}
