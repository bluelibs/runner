import type {
  IResourceMiddleware,
  IResourceMiddlewareDefinition,
} from "../types/resourceMiddleware";
import type { ResourceMiddlewareTagType } from "../types/tag";
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
  TTags extends ResourceMiddlewareTagType[] = ResourceMiddlewareTagType[],
>(
  middlewareDef: MiddlewareDefWithInferredSchema<TSchema, TDependencies> &
    Pick<
      IResourceMiddlewareDefinition<
        InferValidationSchemaInput<TSchema>,
        TEnforceInputContract,
        TEnforceOutputContract,
        TDependencies,
        TTags
      >,
      "run"
    >,
): IResourceMiddleware<
  InferValidationSchemaInput<TSchema>,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies,
  TTags
>;
export function defineResourceMiddleware<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
  TTags extends ResourceMiddlewareTagType[] = ResourceMiddlewareTagType[],
>(
  middlewareDef: IResourceMiddlewareDefinition<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags
  >,
): IResourceMiddleware<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies,
  TTags
>;
export function defineResourceMiddleware<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
  TTags extends ResourceMiddlewareTagType[] = ResourceMiddlewareTagType[],
>(
  middlewareDef: IResourceMiddlewareDefinition<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags
  >,
): IResourceMiddleware<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies,
  TTags
> {
  return defineMiddlewareCore<TConfig, TDependencies>(
    resourceVariant,
    getCallerFile(),
    middlewareDef,
  ) as unknown as IResourceMiddleware<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags
  >;
}
