import type {
  ITaskMiddleware,
  ITaskMiddlewareDefinition,
  DependencyMapType,
  TaskMiddlewareTagType,
} from "../types/taskMiddleware";
import type { JournalKeyBag } from "../types/executionJournal";
import type {
  InferValidationSchemaInput,
  ValidationSchemaInput,
} from "../types/utilities";
import { symbolTaskMiddleware } from "../types/symbols";
import { getCallerFile } from "../tools/getCallerFile";
import {
  defineMiddlewareCore,
  type MiddlewareVariant,
} from "./defineMiddleware.core";

const taskVariant: MiddlewareVariant = {
  typeSymbol: symbolTaskMiddleware,
  label: "Task middleware",
  kind: "task-middleware",
  tagTarget: "taskMiddlewares",
};

type TaskMiddlewareDefinitionWithSchema<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies extends DependencyMapType,
  TTags extends TaskMiddlewareTagType[],
  TJournalKeys extends JournalKeyBag,
  TSchema extends ValidationSchemaInput<any>,
> = Omit<
  ITaskMiddlewareDefinition<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags,
    TJournalKeys
  >,
  "configSchema"
> & {
  configSchema: TSchema;
};

type TaskMiddlewareDefinitionWithoutJournal<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies extends DependencyMapType,
  TTags extends TaskMiddlewareTagType[],
> = Omit<
  ITaskMiddlewareDefinition<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags,
    {}
  >,
  "journal"
> & {
  journal?: never;
};

/**
 * Defines task middleware directly from a configuration object.
 */
export function defineTaskMiddleware<
  TSchema extends ValidationSchemaInput<any>,
  const TJournalKeys extends JournalKeyBag = {},
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
  TTags extends TaskMiddlewareTagType[] = TaskMiddlewareTagType[],
>(
  middlewareDef: TaskMiddlewareDefinitionWithSchema<
    InferValidationSchemaInput<TSchema>,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags,
    TJournalKeys,
    TSchema
  >,
): ITaskMiddleware<
  InferValidationSchemaInput<TSchema>,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies,
  TTags,
  TJournalKeys
>;
export function defineTaskMiddleware<
  const TJournalKeys extends JournalKeyBag = {},
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
  TTags extends TaskMiddlewareTagType[] = TaskMiddlewareTagType[],
>(
  middlewareDef: ITaskMiddlewareDefinition<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags,
    TJournalKeys
  >,
): ITaskMiddleware<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies,
  TTags,
  TJournalKeys
>;
export function defineTaskMiddleware<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
  TTags extends TaskMiddlewareTagType[] = TaskMiddlewareTagType[],
>(
  middlewareDef: TaskMiddlewareDefinitionWithoutJournal<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags
  >,
): ITaskMiddleware<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies,
  TTags,
  {}
>;
export function defineTaskMiddleware<
  TConfig = any,
  TEnforceInputContract = void,
  TEnforceOutputContract = void,
  TDependencies extends DependencyMapType = any,
  TTags extends TaskMiddlewareTagType[] = [],
  TJournalKeys extends JournalKeyBag = {},
>(
  middlewareDef: ITaskMiddlewareDefinition<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags,
    TJournalKeys
  >,
): ITaskMiddleware<
  TConfig,
  TEnforceInputContract,
  TEnforceOutputContract,
  TDependencies,
  TTags,
  TJournalKeys
> {
  return defineMiddlewareCore<TConfig, TDependencies, TJournalKeys>(
    taskVariant,
    getCallerFile(),
    middlewareDef,
  ) as unknown as ITaskMiddleware<
    TConfig,
    TEnforceInputContract,
    TEnforceOutputContract,
    TDependencies,
    TTags,
    TJournalKeys
  >;
}
