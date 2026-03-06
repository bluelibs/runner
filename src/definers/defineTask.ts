import type {
  ITask,
  ITaskDefinition,
  DependencyMapType,
  ITaskMeta,
  TaskTagType,
  IOptionalDependency,
  TaskMiddlewareAttachmentType,
} from "../types/task";
import {
  symbolTask,
  symbolFilePath,
  symbolOptionalDependency,
} from "../types/symbols";
import { getCallerFile } from "../tools/getCallerFile";
import { deepFreeze, freezeIfLineageLocked } from "../tools/deepFreeze";
import { normalizeThrows } from "../tools/throws";
import { assertTagTargetsApplicableTo } from "./assertTagTargetsApplicable";
import { assertDefinitionId } from "./assertDefinitionId";
import { isFrameworkDefinitionMarked } from "./markFrameworkDefinition";
import { normalizeOptionalValidationSchema } from "./normalizeValidationSchema";

/**
 * Define a task.
 * Generates a strongly-typed task object with id, dependencies,
 * middleware, and metadata.
 *
 * @typeParam Input - Input type accepted by the task's `run` function.
 * @typeParam Output - Promise type returned by the `run` function.
 * @typeParam Deps - Dependency map type this task requires.
 * @typeParam TOn - Event type or "*" this task listens to.
 * @typeParam TMeta - Arbitrary metadata type carried by the task.
 * @param taskConfig - The task definition config.
 * @returns A branded task definition usable by the runner.
 */
export function defineTask<
  Input = undefined,
  Output extends Promise<any> = any,
  Deps extends DependencyMapType = any,
  TMeta extends ITaskMeta = any,
  TTags extends TaskTagType[] = TaskTagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[] =
    TaskMiddlewareAttachmentType[],
>(
  taskConfig: ITaskDefinition<Input, Output, Deps, TMeta, TTags, TMiddleware>,
): ITask<Input, Output, Deps, TMeta, TTags, TMiddleware> {
  const filePath = getCallerFile();
  const id = taskConfig.id;
  assertDefinitionId("Task", id, {
    allowReservedDottedNamespace: isFrameworkDefinitionMarked(taskConfig),
  });
  const inputSchema = normalizeOptionalValidationSchema(
    taskConfig.inputSchema,
    {
      definitionId: id,
      subject: "Task input",
    },
  );
  const resultSchema = normalizeOptionalValidationSchema(
    taskConfig.resultSchema,
    {
      definitionId: id,
      subject: "Task result",
    },
  );
  assertTagTargetsApplicableTo("tasks", "Task", id, taskConfig.tags);
  return deepFreeze({
    [symbolTask]: true,
    [symbolFilePath]: filePath,
    id,
    dependencies: taskConfig.dependencies || ({} as Deps),
    middleware:
      taskConfig.middleware ||
      ([] as TaskMiddlewareAttachmentType[] as TMiddleware),
    run: taskConfig.run,
    inputSchema,
    resultSchema,
    meta: taskConfig.meta || ({} as TMeta),
    tags: taskConfig.tags || ([] as TaskTagType[] as TTags),
    throws: normalizeThrows({ kind: "task", id }, taskConfig.throws),
    // autorun,
    optional() {
      const wrapper = {
        inner: this,
        [symbolOptionalDependency]: true,
      } as IOptionalDependency<
        ITask<Input, Output, Deps, TMeta, TTags, TMiddleware>
      >;
      return freezeIfLineageLocked(this, wrapper);
    },
  });
}
