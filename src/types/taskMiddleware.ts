import {
  DependencyMapType,
  DependencyValuesType,
  IValidationSchema,
} from "./utilities";
import type { ITask } from "./task";
import type { ExecutionJournal } from "./executionJournal";
import { TaskMiddlewareTagType } from "./tag";
import { IMiddlewareMeta } from "./meta";
import type {
  TaskMiddlewareApplyTo,
  TaskMiddlewareApplyToWhen,
} from "./middlewareApplyTo";
import {
  symbolFilePath,
  symbolMiddlewareConfigured,
  symbolTaskMiddlewareRegistration,
  symbolTaskMiddleware,
} from "./symbols";
import { IContractable } from "./contracts";
import type { ThrowsList } from "./error";

export type { DependencyMapType, DependencyValuesType } from "./utilities";
export type { TagType, TaskMiddlewareTagType } from "./tag";
export type { IMiddlewareMeta } from "./meta";
export type { TaskMiddlewareApplyTo, TaskMiddlewareApplyToWhen };

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
  tags?: TaskMiddlewareTagType[];
  /**
   * Declares which typed errors are part of this middleware's contract.
   * Declarative only — does not imply DI or enforcement.
   */
  throws?: ThrowsList;
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
  dependencies: TDependencies | ((config: TConfig) => TDependencies);
  /** Normalized list of error ids declared via `throws`. */
  throws?: readonly string[];
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
  /**
   * Binds an auto-apply policy at registration level.
   * Use this on the value you pass into `resource.register([...])`.
   */
  applyTo: (
    scope: TaskMiddlewareApplyTo["scope"],
    when?: TaskMiddlewareApplyToWhen,
  ) => ITaskMiddlewareRegistration<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  >;
  tags: TaskMiddlewareTagType[];
}

export interface ITaskMiddlewareRegistration<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
> {
  [symbolTaskMiddlewareRegistration]: true;
  /** Stable middleware id for ownership and visibility tracking. */
  id: string;
  middleware: ITaskMiddleware<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  >;
  applyTo: TaskMiddlewareApplyTo;
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
  /** Per-execution registry for sharing state between middleware and task */
  journal: ExecutionJournal;
}

export type TaskMiddlewareAttachmentType =
  | ITaskMiddleware<void, any, any, any>
  | ITaskMiddleware<{ [K in any]?: any }, any, any, any>
  | ITaskMiddlewareConfigured<any, any, any, any>;
