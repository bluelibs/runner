import {
  ITaskMiddleware,
  ITaskMiddlewareDefinition,
  DependencyMapType,
  ITask,
  symbolFilePath,
  symbolTaskMiddleware,
  symbolMiddlewareConfigured,
  symbolMiddlewareEverywhereTasks,
} from "../defs";
import { MiddlewareAlreadyGlobalError, ValidationError } from "../errors";
import { getCallerFile } from "../tools/getCallerFile";

/**
 * Define a middleware.
 * Creates a middleware definition with anonymous id generation, `.with(config)`,
 * and `.everywhere()` helpers.
 *
 * - `.with(config)` merges config (optionally validated via `configSchema`).
 * - `.everywhere()` marks the middleware global (optionally scoping to tasks/resources).
 *
 * @typeParam TConfig - Configuration type accepted by the middleware.
 * @typeParam TDependencies - Dependency map type required by the middleware.
 * @param middlewareDef - The middleware definition config.
 * @returns A branded middleware definition usable by the runner.
 */
export function defineTaskMiddleware<
  TConfig extends Record<string, any> = any,
  TDependencies extends DependencyMapType = any,
>(
  middlewareDef: ITaskMiddlewareDefinition<TConfig, TDependencies>,
): ITaskMiddleware<TConfig, TDependencies> {
  const filePath = getCallerFile();
  const base = {
    [symbolFilePath]: filePath,
    [symbolTaskMiddleware]: true,
    config: {} as TConfig,
    configSchema: middlewareDef.configSchema,
    ...middlewareDef,
    dependencies: middlewareDef.dependencies || ({} as TDependencies),
  } as ITaskMiddleware<TConfig, TDependencies>;

  const wrap = (
    obj: ITaskMiddleware<TConfig, TDependencies>,
  ): ITaskMiddleware<TConfig, TDependencies> => {
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
              error instanceof Error ? error : new Error(String(error)),
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
        } as ITaskMiddleware<TConfig, TDependencies>);
      },
      everywhere(
        filter: boolean | ((task: ITask<any, any, any, any>) => boolean) = true,
      ) {
        if (obj[symbolMiddlewareEverywhereTasks]) {
          throw new MiddlewareAlreadyGlobalError(obj.id);
        }
        return wrap({
          ...obj,
          [symbolMiddlewareEverywhereTasks]: filter,
        } as ITaskMiddleware<TConfig, TDependencies>);
      },
    } as ITaskMiddleware<TConfig, TDependencies>;
  };

  return wrap(base);
}