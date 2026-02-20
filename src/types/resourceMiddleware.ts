import {
  DependencyMapType,
  DependencyValuesType,
  IValidationSchema,
} from "./utilities";
import type { IResource } from "./resource";
import { TagType } from "./tag";
import { IMiddlewareMeta } from "./meta";
import {
  symbolFilePath,
  symbolMiddlewareConfigured,
  symbolResourceMiddleware,
} from "./symbols";
import { IContractable } from "./contracts";
import type { ThrowsList } from "./error";

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
    input: IResourceMiddlewareExecutionInput<
      TEnforceInputContract extends void ? any : TEnforceInputContract,
      TEnforceOutputContract extends void ? any : TEnforceOutputContract
    >,
    dependencies: DependencyValuesType<TDependencies>,
    config: TConfig,
  ) => Promise<any>;
  meta?: IMiddlewareMeta;
  tags?: TagType[];
  /**
   * Declares which typed errors are part of this middleware's contract.
   * Declarative only — does not imply DI or enforcement.
   */
  throws?: ThrowsList;
  everywhere?:
    | boolean
    | ((resource: IResource<any, any, any, any, any>) => boolean);
}

export interface IResourceMiddleware<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
>
  extends
    IResourceMiddlewareDefinition<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TDependencies
    >,
    IContractable<TConfig, TEnforceInputContract, TEnforceOutputContract> {
  [symbolResourceMiddleware]: true;

  id: string;
  dependencies: TDependencies | ((config: TConfig) => TDependencies);
  /** Normalized list of error ids declared via `throws`. */
  throws?: readonly string[];
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

export interface IResourceMiddlewareExecutionInput<
  TResourceConfig = any,
  TResourceOutput = any,
> {
  /** Resource hook */
  resource: {
    definition: IResource<TResourceConfig, any, any, any, any>;
    config: TResourceConfig;
  };
  next: (resourceConfig?: TResourceConfig) => Promise<TResourceOutput>;
}

export type ResourceMiddlewareAttachmentType =
  | IResourceMiddleware<void, any, any, any>
  | IResourceMiddleware<{ [K in any]?: any }, any, any, any>
  | IResourceMiddlewareConfigured<any, any, any, any>;
