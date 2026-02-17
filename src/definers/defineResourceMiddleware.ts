import {
  IResourceMiddleware,
  IResourceMiddlewareDefinition,
  DependencyMapType,
  symbolFilePath,
  symbolResourceMiddleware,
  symbolMiddlewareConfigured,
  IResourceMiddlewareConfigured,
} from "../defs";
import { validationError } from "../errors";
import { getCallerFile } from "../tools/getCallerFile";
import { mergeMiddlewareConfig } from "./middlewareConfig";
import { normalizeThrows } from "../tools/throws";

export function defineResourceMiddleware<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
>(
  middlewareDef: IResourceMiddlewareDefinition<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  >,
): IResourceMiddleware<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies
> {
  const filePath = getCallerFile();
  const base = {
    [symbolFilePath]: filePath,
    [symbolResourceMiddleware]: true,
    config: {} as TConfig,
    configSchema: middlewareDef.configSchema,
    ...middlewareDef,
    dependencies: middlewareDef.dependencies || ({} as TDependencies),
    throws: normalizeThrows(
      { kind: "resource-middleware", id: middlewareDef.id },
      middlewareDef.throws,
    ),
  } as IResourceMiddleware<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  >;

  const wrap = (
    obj: IResourceMiddleware<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TDependencies
    > & {
      [symbolMiddlewareConfigured]?: true;
    },
  ): IResourceMiddleware<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  > => {
    const resolveCurrent = (
      candidate: unknown,
    ): IResourceMiddleware<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TDependencies
    > & {
      [symbolMiddlewareConfigured]?: true;
    } => {
      if (
        candidate &&
        typeof candidate === "object" &&
        symbolResourceMiddleware in candidate
      ) {
        return candidate as IResourceMiddleware<
          TConfig,
          TEnforceInputContract,
          TEnforceOutputContract,
          TDependencies
        > & {
          [symbolMiddlewareConfigured]?: true;
        };
      }
      return obj;
    };

    return {
      ...obj,
      with: function (config: TConfig) {
        const current = resolveCurrent(this);

        if (current.configSchema) {
          try {
            config = current.configSchema.parse(config);
          } catch (error) {
            validationError.throw({
              subject: "Middleware config",
              id: current.id,
              originalError:
                error instanceof Error ? error : new Error(String(error)),
            });
          }
        }
        return wrap({
          ...current,
          [symbolMiddlewareConfigured]: true,
          config: mergeMiddlewareConfig(current.config as TConfig, config),
        } satisfies IResourceMiddlewareConfigured<
          TConfig,
          TEnforceInputContract,
          TEnforceOutputContract,
          TDependencies
        >);
      },
    } as IResourceMiddleware<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TDependencies
    >;
  };

  return wrap(base);
}
