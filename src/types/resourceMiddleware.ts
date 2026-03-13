import {
  DependencyMapType,
  DependencyValuesType,
  IValidationSchema,
  ValidationSchemaInput,
} from "./utilities";
import type { IResource } from "./resource";
import { ResourceMiddlewareTagType } from "./tag";
import { IMiddlewareMeta } from "./meta";
import {
  symbolFilePath,
  symbolMiddlewareConfigured,
  symbolRuntimeId,
  symbolResourceMiddleware,
} from "./symbols";
import { IContractable } from "./contracts";
import type { NormalizedThrowsList, ThrowsList } from "./error";

/**
 * Declarative resource-middleware definition contract.
 */
export interface IResourceMiddlewareDefinition<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
> {
  /** Stable middleware identifier. */
  id: string;
  /** Static or lazy dependency map. */
  dependencies?: TDependencies | ((config: TConfig) => TDependencies);
  /**
   * Optional validation schema for runtime config validation.
   * When provided, middleware config will be validated when .with() is called.
   */
  configSchema?: ValidationSchemaInput<TConfig>;
  /**
   * The middleware body, called with resource execution input.
   */
  run: (
    input: IResourceMiddlewareExecutionInput<
      TEnforceInputContract extends void ? any : TEnforceInputContract,
      TEnforceOutputContract extends void ? any : TEnforceOutputContract
    >,
    dependencies: DependencyValuesType<TDependencies>,
    config: TConfig,
  ) => Promise<any>;
  /** Optional metadata used by docs and tooling. */
  meta?: IMiddlewareMeta;
  /** Tags applied to the middleware definition. */
  tags?: ResourceMiddlewareTagType[];
  /**
   * Declares which typed errors are part of this middleware's contract.
   * Declarative only — does not imply DI or enforcement.
   */
  throws?: ThrowsList;
}

/**
 * Normalized runtime resource-middleware definition.
 */
export interface IResourceMiddleware<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
>
  extends
    Omit<
      IResourceMiddlewareDefinition<
        TConfig,
        TEnforceInputContract,
        TEnforceOutputContract,
        TDependencies
      >,
      "throws"
    >,
    IContractable<TConfig, TEnforceInputContract, TEnforceOutputContract> {
  [symbolResourceMiddleware]: true;

  id: string;
  path?: string;
  [symbolRuntimeId]?: string;
  /** Normalized dependency declaration. */
  dependencies: TDependencies | ((config: TConfig) => TDependencies);
  /** Normalized list of error ids declared via `throws`. */
  throws?: NormalizedThrowsList;
  /** Current configuration object (empty by default). */
  config: TConfig;
  /** Normalized validation schema for middleware config. */
  configSchema?: IValidationSchema<TConfig>;
  /** Configure the middleware and return a marked, configured instance. */
  with: (
    config: TConfig,
  ) => IResourceMiddlewareConfigured<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  >;
  [symbolFilePath]: string;
  /** Normalized tags attached to the middleware. */
  tags: ResourceMiddlewareTagType[];
}

/**
 * Configured resource-middleware instance returned by `.with(...)`.
 */
export interface IResourceMiddlewareConfigured<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
> extends IResourceMiddleware<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies
> {
  [symbolMiddlewareConfigured]: true;
}

/**
 * Input object passed to resource middleware `run(...)`.
 */
export interface IResourceMiddlewareExecutionInput<
  TResourceConfig = any,
  TResourceOutput = any,
> {
  /** Current resource definition and config being processed. */
  resource: {
    definition: IResource<TResourceConfig, any, any, any, any>;
    config: TResourceConfig;
  };
  /** Continues execution, optionally overriding the resource config. */
  next: (resourceConfig?: TResourceConfig) => Promise<TResourceOutput>;
}

/**
 * Any resource-middleware value that may appear in a resource middleware attachment list.
 */
export type ResourceMiddlewareAttachmentType =
  | IResourceMiddleware<void, any, any, any>
  | IResourceMiddleware<{ [K in any]?: any }, any, any, any>
  | IResourceMiddlewareConfigured<any, any, any, any>;
