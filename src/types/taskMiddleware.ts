import {
  DependencyMapType,
  DependencyValuesType,
  IValidationSchema,
  ITask,
} from "../defs";
import { TagType } from "./tag";
import { IMiddlewareMeta } from "./meta";
import {
  symbolFilePath,
  symbolMiddlewareConfigured,
  symbolTaskMiddleware,
  symbolMiddlewareEverywhereTasks,
} from "./utilities";
import { IContractable } from "./contracts";

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
    input: ITaskMiddlewareExecutionInput<any>,
    dependencies: DependencyValuesType<TDependencies>,
    config: TConfig,
  ) => Promise<any>;
  meta?: IMiddlewareMeta;
  tags?: TagType[];
}

export interface ITaskMiddleware<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
> extends ITaskMiddlewareDefinition<
      TConfig,
      TEnforceInputContract,
      TEnforceOutputContract,
      TDependencies
    >,
    IContractable<TConfig, TEnforceInputContract, TEnforceOutputContract> {
  [symbolTaskMiddleware]: true;
  [symbolMiddlewareEverywhereTasks]?:
    | boolean
    | ((task: ITask<any, any, any, any>) => boolean);

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
  /** Attach globally to all tasks or filtered tasks. */
  everywhere(
    filter?: boolean | ((task: ITask<any, any, any, any>) => boolean),
  ): ITaskMiddleware<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  >;
  [symbolFilePath]: string;
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

export interface ITaskMiddlewareExecutionInput<TTaskInput = any> {
  /** Task hook */
  task: {
    definition: ITask<TTaskInput, any, any, any>;
    input: TTaskInput;
  };
  next: (taskInput?: TTaskInput) => Promise<any>;
}

export type TaskMiddlewareAttachmentType =
  | ITaskMiddleware<void, any, any, any>
  | ITaskMiddleware<{ [K in any]?: any }, any, any, any>
  | ITaskMiddlewareConfigured<any, any, any, any>;
