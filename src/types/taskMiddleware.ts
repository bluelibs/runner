import {
  DependencyMapType,
  DependencyValuesType,
  IValidationSchema,
  ValidationSchemaInput,
} from "./utilities";
import type { ITask } from "./task";
import type { ExecutionJournal, JournalKeyBag } from "./executionJournal";
import { TaskMiddlewareTagType } from "./tag";
import { IMiddlewareMeta } from "./meta";
import {
  symbolFilePath,
  symbolMiddlewareConfigured,
  symbolTaskMiddleware,
} from "./symbols";
import {
  EnsureConfigSatisfiesContracts,
  HasConfigContracts,
  IContractable,
  InferConfigOrViolationFromContracts,
} from "./contracts";
import type { NormalizedThrowsList, ThrowsList } from "./error";

export type { DependencyMapType, DependencyValuesType } from "./utilities";
export type { TagType, TaskMiddlewareTagType } from "./tag";
export type { IMiddlewareMeta } from "./meta";

type IsUnspecifiedMiddlewareConfig<T> = [T] extends [void]
  ? true
  : [T] extends [undefined]
    ? true
    : false;

type IsAny<T> = 0 extends 1 & T ? true : false;

type ResolveMiddlewareConfigContract<
  TConfig,
  TTags extends TaskMiddlewareTagType[],
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
export type ResolvedTaskMiddlewareConfig<
  TConfig,
  TTags extends TaskMiddlewareTagType[],
> = ResolveMiddlewareConfigContract<TConfig, TTags>;

/**
 * Declarative task-middleware definition contract.
 */
export interface ITaskMiddlewareDefinition<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
  TTags extends TaskMiddlewareTagType[] = TaskMiddlewareTagType[],
  TJournalKeys extends JournalKeyBag = {},
> {
  /** Stable middleware identifier. */
  id: string;
  /** Static or lazy dependency map. */
  dependencies?:
    | TDependencies
    | ((config: ResolvedTaskMiddlewareConfig<TConfig, TTags>) => TDependencies);
  /**
   * Optional validation schema for runtime config validation.
   * When provided, middleware config will be validated when .with() is called.
   */
  configSchema?: ValidationSchemaInput<
    ResolvedTaskMiddlewareConfig<TConfig, TTags>
  >;
  /**
   * The middleware body, called with task execution input.
   */
  run: (
    input: ITaskMiddlewareExecutionInput<
      TEnforceInputContract extends void ? any : TEnforceInputContract,
      TEnforceOutputContract extends void ? any : TEnforceOutputContract
    >,
    dependencies: DependencyValuesType<TDependencies>,
    config: ResolvedTaskMiddlewareConfig<TConfig, TTags>,
  ) => Promise<any>;
  /** Optional metadata used by docs and tooling. */
  meta?: IMiddlewareMeta;
  /** Journal keys exposed by this middleware for execution-local coordination. */
  journal?: TJournalKeys;
  /** Tags applied to the middleware definition. */
  tags?: TTags;
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
  TTags extends TaskMiddlewareTagType[] = TaskMiddlewareTagType[],
  TJournalKeys extends JournalKeyBag = {},
>
  extends
    Omit<
      ITaskMiddlewareDefinition<
        TConfig,
        TEnforceInputContract,
        TEnforceOutputContract,
        TDependencies,
        TTags,
        TJournalKeys
      >,
      "throws" | "journal"
    >,
    IContractable<
      ResolvedTaskMiddlewareConfig<TConfig, TTags>,
      TEnforceInputContract,
      TEnforceOutputContract
    > {
  [symbolTaskMiddleware]: true;
  [symbolFilePath]: string;
  id: string;
  path?: string;
  /** Normalized dependency declaration. */
  dependencies:
    | TDependencies
    | ((config: ResolvedTaskMiddlewareConfig<TConfig, TTags>) => TDependencies);
  /** Normalized list of error ids declared via `throws`. */
  throws?: NormalizedThrowsList;
  /** Current configuration object (empty by default). */
  config: ResolvedTaskMiddlewareConfig<TConfig, TTags>;
  /** Normalized validation schema for middleware config. */
  configSchema?: IValidationSchema<
    ResolvedTaskMiddlewareConfig<TConfig, TTags>
  >;
  /** Configure the middleware and return a marked, configured instance. */
  with: (
    config: ResolvedTaskMiddlewareConfig<TConfig, TTags>,
  ) => ITaskMiddlewareConfigured<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags,
    TJournalKeys
  >;
  /** Extract the configured payload from a matching middleware entry. */
  extract: (
    target: ITaskMiddleware<any, any, any, any, any>,
  ) => ResolvedTaskMiddlewareConfig<TConfig, TTags> | undefined;
  /** Typed journal keys owned by this middleware definition. */
  readonly journalKeys: TJournalKeys;
  /** Normalized tags attached to the middleware. */
  tags: TTags;
}

/**
 * Configured task-middleware instance returned by `.with(...)`.
 */
export interface ITaskMiddlewareConfigured<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
  TTags extends TaskMiddlewareTagType[] = TaskMiddlewareTagType[],
  TJournalKeys extends JournalKeyBag = {},
> extends ITaskMiddleware<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies,
  TTags,
  TJournalKeys
> {
  [symbolMiddlewareConfigured]: true;
  config: ResolvedTaskMiddlewareConfig<TConfig, TTags>;
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
