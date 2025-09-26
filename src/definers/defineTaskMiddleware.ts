import {
  ITaskMiddleware,
  ITaskMiddlewareDefinition,
  DependencyMapType,
  ITask,
  symbolFilePath,
  symbolTaskMiddleware,
  symbolMiddlewareConfigured,
  ITaskMiddlewareConfigured,
} from "../defs";
import { validationError } from "../errors";
import { getCallerFile } from "../tools/getCallerFile";

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
    dependencies:
      (middlewareDef.dependencies as TDependencies) || ({} as TDependencies),
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
    return {
      ...obj,
      with: (config: TConfig) => {
        if (obj.configSchema) {
          try {
            config = obj.configSchema.parse(config);
          } catch (error) {
            validationError.throw({
              subject: "Middleware config",
              id: obj.id,
              originalError:
                error instanceof Error ? error : new Error(String(error)),
            });
          }
        }
        return wrap({
          ...obj,
          [symbolMiddlewareConfigured]: true,
          config: {
            ...(obj.config as TConfig),
            ...config,
          },
        } satisfies ITaskMiddlewareConfigured<TConfig, TEnforceInputContract, TEnforceOutputContract, TDependencies>);
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
