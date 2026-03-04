import type {
  ITaskMiddleware,
  ITaskMiddlewareConfigured,
  ITaskMiddlewareDefinition,
  DependencyMapType,
} from "../types/taskMiddleware";
import {
  symbolFilePath,
  symbolMiddlewareConfigured,
  symbolMiddlewareConfiguredFrom,
  symbolTaskMiddleware,
} from "../types/symbols";
import { validationError } from "../errors";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze, freezeIfLineageLocked } from "../tools/deepFreeze";
import { mergeMiddlewareConfig } from "./middlewareConfig";
import { assertTagTargetsApplicableTo } from "./assertTagTargetsApplicable";
import { assertDefinitionId } from "./assertDefinitionId";
import { normalizeThrows } from "../tools/throws";
import { normalizeOptionalValidationSchema } from "./normalizeValidationSchema";

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
  assertDefinitionId("Task middleware", middlewareDef.id);
  const configSchema = normalizeOptionalValidationSchema(
    middlewareDef.configSchema,
    {
      definitionId: middlewareDef.id,
      subject: "Middleware config",
    },
  );
  assertTagTargetsApplicableTo(
    "taskMiddlewares",
    "Task middleware",
    middlewareDef.id,
    middlewareDef.tags,
  );

  const base = {
    [symbolFilePath]: filePath,
    [symbolTaskMiddleware]: true,
    config: {} as TConfig,
    ...middlewareDef,
    configSchema,
    dependencies: middlewareDef.dependencies || ({} as TDependencies),
    throws: normalizeThrows(
      { kind: "task-middleware", id: middlewareDef.id },
      middlewareDef.throws,
    ),
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
        const configuredFrom =
          (current as unknown as Record<symbol, unknown>)[
            symbolMiddlewareConfiguredFrom
          ] ?? current;
        const configured = wrap({
          ...current,
          [symbolMiddlewareConfigured]: true,
          config: mergeMiddlewareConfig(current.config as TConfig, config),
        } satisfies ITaskMiddlewareConfigured<
          TConfig,
          TEnforceInputContract,
          TEnforceOutputContract,
          TDependencies
        >);
        (configured as unknown as Record<symbol, unknown>)[
          symbolMiddlewareConfiguredFrom
        ] = configuredFrom;
        return freezeIfLineageLocked(current, configured);
      },
    } as ITaskMiddleware<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TDependencies
    >;
  };

  return deepFreeze(wrap(base));
}
