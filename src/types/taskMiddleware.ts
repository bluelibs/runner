import {
  DependencyMapType,
  DependencyValuesType,
  IValidationSchema,
} from "./utilities";
import type { ITask } from "./task";
import { TagType } from "./tag";
import { IMiddlewareMeta } from "./meta";
import {
  symbolFilePath,
  symbolMiddlewareConfigured,
  symbolTaskMiddleware,
} from "./symbols";
import { IContractable } from "./contracts";

export type { DependencyMapType, DependencyValuesType } from "./utilities";
export type { TagType } from "./tag";
export type { IMiddlewareMeta } from "./meta";

export interface ITaskMiddlewareDefinition<
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
   * The middleware body, called with task execution input.
   */
  run: (
    input: ITaskMiddlewareExecutionInput<
      TEnforceInputContract extends void ? any : TEnforceInputContract,
      TEnforceOutputContract extends void ? any : TEnforceOutputContract
    >,
    dependencies: DependencyValuesType<TDependencies>,
    config: TConfig,
  ) => Promise<any>;
  meta?: IMiddlewareMeta;
  tags?: TagType[];
  everywhere?: boolean | ((task: ITask<any, any, any, any>) => boolean);
}

export interface ITaskMiddleware<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
>
  extends
    ITaskMiddlewareDefinition<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TDependencies
    >,
    IContractable<TConfig, TEnforceInputContract, TEnforceOutputContract> {
  [symbolTaskMiddleware]: true;
  [symbolFilePath]: string;
  id: string;
  dependencies: TDependencies | (() => TDependencies);
  /** Current configuration object (empty by default). */
  config: TConfig;
  /** Configure the middleware and return a marked, configured instance. */
  with: (
    config: TConfig,
  ) => ITaskMiddlewareConfigured<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  >;
  tags: TagType[];
}

export interface ITaskMiddlewareConfigured<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
> extends ITaskMiddleware<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies
> {
  [symbolMiddlewareConfigured]: true;
  config: TConfig;
}

export interface ITaskMiddlewareExecutionInput<
  TTaskInput = any,
  TTaskOutput = any,
> {
  /** Task hook */
  task: {
    definition: ITask<TTaskInput, any, any, any>;
    input: TTaskInput;
  };
  next: (taskInput?: TTaskInput) => Promise<TTaskOutput>;
}

export type TaskMiddlewareAttachmentType =
  | ITaskMiddleware<void, any, any, any>
  | ITaskMiddleware<{ [K in any]?: any }, any, any, any>
  | ITaskMiddlewareConfigured<any, any, any, any>;
