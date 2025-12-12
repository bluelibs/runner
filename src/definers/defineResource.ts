import {
  IResource,
  IResourceDefinition,
  DependencyMapType,
  IResourceMeta,
  TagType,
  symbolResource,
  symbolFilePath,
  symbolResourceWithConfig,
  symbolOptionalDependency,
  IOptionalDependency,
  ResourceMiddlewareAttachmentType,
  IResourceWithConfig,
} from "../defs";
import { validationError } from "../errors";
import { getCallerFile } from "../tools/getCallerFile";
import { normalizeThrows } from "../tools/throws";

export function defineResource<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TPrivate = any,
  TMeta extends IResourceMeta = any,
  TTags extends TagType[] = TagType[],
  TMiddleware extends ResourceMiddlewareAttachmentType[] = ResourceMiddlewareAttachmentType[],
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

  return {
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
    tags: constConfig.tags || ([] as unknown as TTags),
    throws: normalizeThrows({ kind: "resource", id }, constConfig.throws),
    with: function (config: TConfig) {
      // Validate config with schema if provided (fail fast)
      if (constConfig.configSchema) {
        try {
          config = constConfig.configSchema.parse(config);
        } catch (error) {
          validationError.throw({
            subject: "Resource config",
            id,
            originalError:
              error instanceof Error ? error : new Error(String(error)),
          });
        }
      }

      return {
        [symbolResourceWithConfig]: true,
        id: this.id,
        resource: this,
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
    },

    meta: (constConfig.meta || {}) as TMeta,
    middleware: constConfig.middleware || ([] as unknown as TMiddleware),
    optional() {
      return {
        inner: this,
        [symbolOptionalDependency]: true,
      } as IOptionalDependency<
        IResource<TConfig, TValue, TDeps, TPrivate, TMeta, TTags, TMiddleware>
      >;
    },
  };
}
