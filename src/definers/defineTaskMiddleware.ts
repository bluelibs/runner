import type {
  ITaskMiddleware,
  ITaskMiddlewareDefinition,
  DependencyMapType,
  ITaskMiddlewareConfigured,
} from "../types/taskMiddleware";
import {
  symbolTaskMiddleware,
  symbolFilePath,
  symbolMiddlewareConfigured,
} from "../types/symbols";
import { validationError } from "../errors";
import { getCallerFile } from "../tools/getCallerFile";
import { mergeMiddlewareConfig } from "./middlewareConfig";

export function defineTaskMiddleware<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
>(
  middlewareDef: ITaskMiddlewareDefinition<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  >,
): ITaskMiddleware<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies
> {
  const filePath = getCallerFile();
  const base = {
    [symbolFilePath]: filePath,
    [symbolTaskMiddleware]: true,
    config: {} as TConfig,
    configSchema: middlewareDef.configSchema,
    ...middlewareDef,
    dependencies: middlewareDef.dependencies || ({} as TDependencies),
  } as ITaskMiddleware<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  >;

  const wrap = (
    obj: ITaskMiddleware<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TDependencies
    > & {
      [symbolMiddlewareConfigured]?: true;
    },
  ): ITaskMiddleware<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  > => {
    const resolveCurrent = (
      candidate: unknown,
    ): ITaskMiddleware<
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
        symbolTaskMiddleware in candidate
      ) {
        return candidate as ITaskMiddleware<
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
        } satisfies ITaskMiddlewareConfigured<
          TConfig,
          TEnforceInputContract,
          TEnforceOutputContract,
          TDependencies
        >);
      },
    } as ITaskMiddleware<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TDependencies
    >;
  };

  return wrap(base);
}
