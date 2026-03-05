import type {
  ITaskMiddleware,
  ITaskMiddlewareDefinition,
  DependencyMapType,
} from "../types/taskMiddleware";
import { symbolTaskMiddleware } from "../types/symbols";
import { getCallerFile } from "../tools/getCallerFile";
import {
  defineMiddlewareCore,
  type MiddlewareVariant,
} from "./defineMiddleware.core";

const taskVariant: MiddlewareVariant = {
  typeSymbol: symbolTaskMiddleware,
  label: "Task middleware",
  kind: "task-middleware",
  tagTarget: "taskMiddlewares",
};

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
  return defineMiddlewareCore<TConfig, TDependencies>(
    taskVariant,
    getCallerFile(),
    middlewareDef,
  ) as unknown as ITaskMiddleware<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  >;
}
