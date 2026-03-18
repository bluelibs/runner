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
  symbolResourceMiddleware,
} from "./symbols";
import {
  EnsureConfigSatisfiesContracts,
  HasConfigContracts,
  IContractable,
  InferConfigOrViolationFromContracts,
} from "./contracts";
import type { NormalizedThrowsList, ThrowsList } from "./error";

type IsUnspecifiedMiddlewareConfig<T> = [T] extends [void]
  ? true
  : [T] extends [undefined]
    ? true
    : false;

type IsAny<T> = 0 extends 1 & T ? true : false;

type ResolveMiddlewareConfigContract<
  TConfig,
  TTags extends ResourceMiddlewareTagType[],
> =
  HasConfigContracts<TTags> extends true
    ? IsAny<TConfig> extends true
      ? InferConfigOrViolationFromContracts<TTags>
      : IsUnspecifiedMiddlewareConfig<TConfig> extends true
        ? InferConfigOrViolationFromContracts<TTags>
        : EnsureConfigSatisfiesContracts<TTags, TConfig>
    : TConfig;

/**
 * Effective middleware config after applying any config-contract tags.
 */
export type ResolvedResourceMiddlewareConfig<
  TConfig,
  TTags extends ResourceMiddlewareTagType[],
> = ResolveMiddlewareConfigContract<TConfig, TTags>;

/**
 * Declarative resource-middleware definition contract.
 */
export interface IResourceMiddlewareDefinition<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
  TTags extends ResourceMiddlewareTagType[] = ResourceMiddlewareTagType[],
> {
  /** Stable middleware identifier. */
  id: string;
  /** Static or lazy dependency map. */
  dependencies?:
    | TDependencies
    | ((
        config: ResolvedResourceMiddlewareConfig<TConfig, TTags>,
      ) => TDependencies);
  /**
   * Optional validation schema for runtime config validation.
   * When provided, middleware config will be validated when .with() is called.
   */
  configSchema?: ValidationSchemaInput<
    ResolvedResourceMiddlewareConfig<TConfig, TTags>
  >;
  /**
   * The middleware body, called with resource execution input.
   */
  run: (
    input: IResourceMiddlewareExecutionInput<
      TEnforceInputContract extends void ? any : TEnforceInputContract,
      TEnforceOutputContract extends void ? any : TEnforceOutputContract
    >,
    dependencies: DependencyValuesType<TDependencies>,
    config: ResolvedResourceMiddlewareConfig<TConfig, TTags>,
  ) => Promise<any>;
  /** Optional metadata used by docs and tooling. */
  meta?: IMiddlewareMeta;
  /** Tags applied to the middleware definition. */
  tags?: TTags;
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
  TTags extends ResourceMiddlewareTagType[] = ResourceMiddlewareTagType[],
>
  extends
    Omit<
      IResourceMiddlewareDefinition<
        TConfig,
        TEnforceInputContract,
        TEnforceOutputContract,
        TDependencies,
        TTags
      >,
      "throws"
    >,
    IContractable<
      ResolvedResourceMiddlewareConfig<TConfig, TTags>,
      TEnforceInputContract,
      TEnforceOutputContract
    > {
  [symbolResourceMiddleware]: true;

  id: string;
  path?: string;
  /** Normalized dependency declaration. */
  dependencies:
    | TDependencies
    | ((
        config: ResolvedResourceMiddlewareConfig<TConfig, TTags>,
      ) => TDependencies);
  /** Normalized list of error ids declared via `throws`. */
  throws?: NormalizedThrowsList;
  /** Current configuration object (empty by default). */
  config: ResolvedResourceMiddlewareConfig<TConfig, TTags>;
  /** Normalized validation schema for middleware config. */
  configSchema?: IValidationSchema<
    ResolvedResourceMiddlewareConfig<TConfig, TTags>
  >;
  /** Configure the middleware and return a marked, configured instance. */
  with: (
    config: ResolvedResourceMiddlewareConfig<TConfig, TTags>,
  ) => IResourceMiddlewareConfigured<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags
  >;
  /** Extract the configured payload from a matching middleware entry. */
  extract: (
    target: IResourceMiddleware<any, any, any, any, any>,
  ) => ResolvedResourceMiddlewareConfig<TConfig, TTags> | undefined;
  [symbolFilePath]: string;
  /** Normalized tags attached to the middleware. */
  tags: TTags;
}

/**
 * Configured resource-middleware instance returned by `.with(...)`.
 */
export interface IResourceMiddlewareConfigured<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
  TTags extends ResourceMiddlewareTagType[] = ResourceMiddlewareTagType[],
> extends IResourceMiddleware<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies,
  TTags
> {
  [symbolMiddlewareConfigured]: true;
  config: ResolvedResourceMiddlewareConfig<TConfig, TTags>;
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
