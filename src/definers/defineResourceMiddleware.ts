import type {
  IResourceMiddleware,
  IResourceMiddlewareDefinition,
} from "../types/resourceMiddleware";
import type { DependencyMapType } from "../types/utilities";
import { symbolResourceMiddleware } from "../types/symbols";
import { getCallerFile } from "../tools/getCallerFile";
import {
  defineMiddlewareCore,
  type MiddlewareVariant,
} from "./defineMiddleware.core";

const resourceVariant: MiddlewareVariant = {
  typeSymbol: symbolResourceMiddleware,
  label: "Resource middleware",
  kind: "resource-middleware",
  tagTarget: "resourceMiddlewares",
};

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
  return defineMiddlewareCore<TConfig, TDependencies>(
    resourceVariant,
    getCallerFile(),
    middlewareDef,
  ) as unknown as IResourceMiddleware<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  >;
}
