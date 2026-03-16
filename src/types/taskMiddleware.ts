import {
  DependencyMapType,
  DependencyValuesType,
  IValidationSchema,
  ValidationSchemaInput,
} from "./utilities";
import type { ITask } from "./task";
import type { ExecutionJournal } from "./executionJournal";
import { TaskMiddlewareTagType } from "./tag";
import { IMiddlewareMeta } from "./meta";
import {
  symbolFilePath,
  symbolMiddlewareConfigured,
  symbolTaskMiddleware,
} from "./symbols";
import { IContractable } from "./contracts";
import type { NormalizedThrowsList, ThrowsList } from "./error";

export type { DependencyMapType, DependencyValuesType } from "./utilities";
export type { TagType, TaskMiddlewareTagType } from "./tag";
export type { IMiddlewareMeta } from "./meta";

/**
 * Declarative task-middleware definition contract.
 */
export interface ITaskMiddlewareDefinition<
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
  /** Optional metadata used by docs and tooling. */
  meta?: IMiddlewareMeta;
  /** Tags applied to the middleware definition. */
  tags?: TaskMiddlewareTagType[];
  /**
   * Declares which typed errors are part of this middleware's contract.
   * Declarative only — does not imply DI or enforcement.
   */
  throws?: ThrowsList;
}

/**
 * Normalized runtime task-middleware definition.
 */
export interface ITaskMiddleware<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
>
  extends
    Omit<
      ITaskMiddlewareDefinition<
        TConfig,
        TEnforceInputContract,
        TEnforceOutputContract,
        TDependencies
      >,
      "throws"
    >,
    IContractable<TConfig, TEnforceInputContract, TEnforceOutputContract> {
  [symbolTaskMiddleware]: true;
  [symbolFilePath]: string;
  id: string;
  path?: string;
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
  ) => ITaskMiddlewareConfigured<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies
  >;
  /** Normalized tags attached to the middleware. */
  tags: TaskMiddlewareTagType[];
}

/**
 * Configured task-middleware instance returned by `.with(...)`.
 */
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

/**
 * Input object passed to task middleware `run(...)`.
 */
export interface ITaskMiddlewareExecutionInput<
  TTaskInput = any,
  TTaskOutput = any,
> {
  /** Current task definition and input being processed. */
  task: {
    definition: ITask<TTaskInput, any, any, any>;
    input: TTaskInput;
  };
  /** Continues execution, optionally overriding the task input. */
  next: (taskInput?: TTaskInput) => Promise<TTaskOutput>;
  /** Per-execution registry for sharing state between middleware and task */
  journal: ExecutionJournal;
}

/**
 * Any task-middleware value that may appear in a task middleware attachment list.
 */
export type TaskMiddlewareAttachmentType =
  | ITaskMiddleware<void, any, any, any>
  | ITaskMiddleware<{ [K in any]?: any }, any, any, any>
  | ITaskMiddlewareConfigured<any, any, any, any>;
