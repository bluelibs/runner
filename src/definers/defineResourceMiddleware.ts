import type {
  IResourceMiddleware,
  IResourceMiddlewareDefinition,
} from "../types/resourceMiddleware";
import type {
  DependencyMapType,
  InferValidationSchemaInput,
  ValidationSchemaInput,
} from "../types/utilities";
import { symbolResourceMiddleware } from "../types/symbols";
import { getCallerFile } from "../tools/getCallerFile";
import {
  defineMiddlewareCore,
  type MiddlewareDefWithInferredSchema,
  type MiddlewareVariant,
} from "./defineMiddleware.core";

const resourceVariant: MiddlewareVariant = {
  typeSymbol: symbolResourceMiddleware,
  label: "Resource middleware",
  kind: "resource-middleware",
  tagTarget: "resourceMiddlewares",
};

/**
 * Defines resource middleware directly from a configuration object.
 */
export function defineResourceMiddleware<
  TSchema extends ValidationSchemaInput<any>,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
>(
  middlewareDef: MiddlewareDefWithInferredSchema<TSchema, TDependencies> &
    Pick<
      IResourceMiddlewareDefinition<
        InferValidationSchemaInput<TSchema>,
        TEnforceInputContract,
        TEnforceOutputContract,
        TDependencies
      >,
      "run"
    >,
): IResourceMiddleware<
  InferValidationSchemaInput<TSchema>,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies
>;
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
>;
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
