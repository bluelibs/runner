import type {
  ITaskMiddleware,
  ITaskMiddlewareDefinition,
  DependencyMapType,
  TaskMiddlewareTagType,
} from "../types/taskMiddleware";
import type {
  InferValidationSchemaInput,
  ValidationSchemaInput,
} from "../types/utilities";
import { symbolTaskMiddleware } from "../types/symbols";
import { getCallerFile } from "../tools/getCallerFile";
import {
  defineMiddlewareCore,
  type MiddlewareDefWithInferredSchema,
  type MiddlewareVariant,
} from "./defineMiddleware.core";

const taskVariant: MiddlewareVariant = {
  typeSymbol: symbolTaskMiddleware,
  label: "Task middleware",
  kind: "task-middleware",
  tagTarget: "taskMiddlewares",
};

/**
 * Defines task middleware directly from a configuration object.
 */
export function defineTaskMiddleware<
  TSchema extends ValidationSchemaInput<any>,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
  TTags extends TaskMiddlewareTagType[] = TaskMiddlewareTagType[],
>(
  middlewareDef: MiddlewareDefWithInferredSchema<TSchema, TDependencies> &
    Pick<
      ITaskMiddlewareDefinition<
        InferValidationSchemaInput<TSchema>,
        TEnforceInputContract,
        TEnforceOutputContract,
        TDependencies,
        TTags
      >,
      "run"
    >,
): ITaskMiddleware<
  InferValidationSchemaInput<TSchema>,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies,
  TTags
>;
export function defineTaskMiddleware<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
  TTags extends TaskMiddlewareTagType[] = TaskMiddlewareTagType[],
>(
  middlewareDef: ITaskMiddlewareDefinition<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags
  >,
): ITaskMiddleware<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies,
  TTags
>;
export function defineTaskMiddleware<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
  TTags extends TaskMiddlewareTagType[] = TaskMiddlewareTagType[],
>(
  middlewareDef: ITaskMiddlewareDefinition<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags
  >,
): ITaskMiddleware<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies,
  TTags
> {
  return defineMiddlewareCore<TConfig, TDependencies>(
    taskVariant,
    getCallerFile(),
    middlewareDef,
  ) as unknown as ITaskMiddleware<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags
  >;
}
