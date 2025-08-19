import {
  DependencyMapType,
  DependencyValuesType,
  IValidationSchema,
  IResource,
} from "../defs";
import { TagType } from "./tag";
import { IMiddlewareMeta } from "./meta";
import {
  symbolFilePath,
  symbolMiddlewareConfigured,
  symbolResourceMiddleware,
  symbolMiddlewareEverywhereResources,
} from "./utilities";
import { IContractable } from "./contracts";

export interface IResourceMiddlewareDefinition<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
> {
  id: string;
  /** Static or lazy dependency map. */
  dependencies?: TDependencies | ((config: TConfig) => TDependencies);
  /**
   * Optional validation schema for runtime config validation.
   * When provided, middleware config will be validated when .with() is called.
   */
  configSchema?: IValidationSchema<TConfig>;
  /**
   * The middleware body, called with resource execution input.
   */
  run: (
    input: IResourceMiddlewareExecutionInput,
    dependencies: DependencyValuesType<TDependencies>,
    config: TConfig,
  ) => Promise<any>;
  meta?: IMiddlewareMeta;
  tags?: TagType[];
}

export interface IResourceMiddleware<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
> extends IResourceMiddlewareDefinition<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TDependencies
    >,
    IContractable<TConfig, TEnforceInputContract, TEnforceOutputContract> {
  [symbolResourceMiddleware]: true;
  [symbolMiddlewareEverywhereResources]?:
    | boolean
    | ((resource: IResource<any, any, any, any, any>) => boolean);

  id: string;
  dependencies: TDependencies | (() => TDependencies);
  /** Current configuration object (empty by default). */
  config: TConfig;
  /** Configure the middleware and return a marked, configured instance. */
  with: (
    config: TConfig,
  ) => IResourceMiddlewareConfigured<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  >;
  /** Attach globally to all resources or filtered resources. */
  everywhere(
    filter?:
      | boolean
      | ((resource: IResource<any, any, any, any, any>) => boolean),
  ): IResourceMiddleware<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  >;
  [symbolFilePath]: string;
  tags: TagType[];
}

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

export interface IResourceMiddlewareExecutionInput<TResourceConfig = any> {
  /** Resource hook */
  resource: {
    definition: IResource<TResourceConfig, any, any, any, any>;
    config: TResourceConfig;
  };
  next: (resourceConfig?: TResourceConfig) => Promise<any>;
}

export type ResourceMiddlewareAttachmentType =
  | IResourceMiddleware<void, any, any, any>
  | IResourceMiddleware<{ [K in any]?: any }, any, any, any>
  | IResourceMiddlewareConfigured<any, any, any, any>;
