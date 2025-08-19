import {
  IResourceMiddleware,
  IResourceMiddlewareDefinition,
  DependencyMapType,
  IResource,
  symbolFilePath,
  symbolResourceMiddleware,
  symbolMiddlewareConfigured,
  symbolMiddlewareEverywhereResources,
} from "../defs";
import { MiddlewareAlreadyGlobalError, ValidationError } from "../errors";
import { getCallerFile } from "../tools/getCallerFile";

export function defineResourceMiddleware<
  TConfig extends Record<string, any> = any,
  TDependencies extends DependencyMapType = any,
>(
  middlewareDef: IResourceMiddlewareDefinition<TConfig, TDependencies>,
): IResourceMiddleware<TConfig, TDependencies> {
  const filePath = getCallerFile();
  const base = {
    [symbolFilePath]: filePath,
    [symbolResourceMiddleware]: true,
    config: {} as TConfig,
    configSchema: middlewareDef.configSchema,
    ...middlewareDef,
    dependencies: middlewareDef.dependencies || ({} as TDependencies),
  } as IResourceMiddleware<TConfig, TDependencies>;

  const wrap = (
    obj: IResourceMiddleware<TConfig, TDependencies>,
  ): IResourceMiddleware<TConfig, TDependencies> => {
    return {
      ...obj,
      with: (config: TConfig) => {
        if (obj.configSchema) {
          try {
            config = obj.configSchema.parse(config);
          } catch (error) {
            throw new ValidationError(
              "Middleware config",
              obj.id,
              error as Error,
            );
          }
        }
        return wrap({
          ...obj,
          [symbolMiddlewareConfigured]: true,
          config: {
            ...(obj.config as TConfig),
            ...config,
          },
        } as IResourceMiddleware<TConfig, TDependencies>);
      },
      everywhere(
        filter:
          | boolean
          | ((resource: IResource<any, any, any, any, any>) => boolean) = true,
      ) {
        if (obj[symbolMiddlewareEverywhereResources]) {
          throw new MiddlewareAlreadyGlobalError(obj.id);
        }
        return wrap({
          ...obj,
          [symbolMiddlewareEverywhereResources]: filter,
        } as IResourceMiddleware<TConfig, TDependencies>);
      },
    } as IResourceMiddleware<TConfig, TDependencies>;
  };

  return wrap(base);
}