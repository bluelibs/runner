import {
  IResource,
  IResourceDefinition,
  DependencyMapType,
  IResourceMeta,
  TagType,
  symbolResource,
  symbolFilePath,
  symbolIndexResource,
  symbolResourceWithConfig,
  symbolOptionalDependency,
  IOptionalDependency,
} from "../defs";
import { ValidationError } from "../errors";
import { getCallerFile } from "../tools/getCallerFile";

export function defineResource<
  TConfig = void,
  TValue extends Promise<any> = Promise<any>,
  TDeps extends DependencyMapType = {},
  TPrivate = any,
  TMeta extends IResourceMeta = any,
  TTags extends TagType[] = TagType[],
>(
  constConfig: IResourceDefinition<
    TConfig,
    TValue,
    TDeps,
    TPrivate,
    any,
    any,
    TMeta,
    TTags
  >,
): IResource<TConfig, TValue, TDeps, TPrivate, TMeta, TTags> {
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
  // The symbolFilePath might already come from defineIndex() for example
  const filePath: string = constConfig[symbolFilePath] || getCallerFile();
  const isIndexResource = constConfig[symbolIndexResource] || false;
  const isAnonymous = !Boolean(constConfig.id);
  const id = constConfig.id;

  return {
    [symbolResource]: true,
    [symbolFilePath]: filePath,
    [symbolIndexResource]: isIndexResource,
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
    with: function (config: TConfig) {
      // Validate config with schema if provided (fail fast)
      if (constConfig.configSchema) {
        try {
          config = constConfig.configSchema.parse(config);
        } catch (error) {
          throw new ValidationError(
            "Resource config",
            id,
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }

      return {
        [symbolResourceWithConfig]: true,
        id: this.id,
        resource: this,
        config,
      };
    },

    meta: (constConfig.meta || {}) as TMeta,
    middleware: constConfig.middleware || [],
    optional() {
      return {
        inner: this,
        [symbolOptionalDependency]: true,
      } as IOptionalDependency<
        IResource<TConfig, TValue, TDeps, TPrivate, TMeta>
      >;
    },
  };
}