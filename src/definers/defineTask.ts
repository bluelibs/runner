import {
  ITask,
  ITaskDefinition,
  DependencyMapType,
  ITaskMeta,
  TagType,
  symbolTask,
  symbolFilePath,
  symbolOptionalDependency,
  IOptionalDependency,
  TaskMiddlewareAttachmentType,
  symbolPhantomTask,
  IPhantomTask,
} from "../defs";
import { getCallerFile } from "../tools/getCallerFile";

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
  TTags extends TagType[] = TagType[],
  TMiddleware extends TaskMiddlewareAttachmentType[] = TaskMiddlewareAttachmentType[],
>(
  taskConfig: ITaskDefinition<Input, Output, Deps, TMeta, TTags, TMiddleware>,
): ITask<Input, Output, Deps, TMeta, TTags, TMiddleware> {
  const filePath = getCallerFile();
  const id = taskConfig.id;
  return {
    [symbolTask]: true,
    [symbolFilePath]: filePath,
    id,
    dependencies: taskConfig.dependencies || ({} as Deps),
    middleware: taskConfig.middleware || ([] as unknown as TMiddleware),
    run: taskConfig.run,
    inputSchema: taskConfig.inputSchema,
    resultSchema: taskConfig.resultSchema,
    meta: taskConfig.meta || ({} as TMeta),
    tags: taskConfig.tags || ([] as unknown as TTags),
    // autorun,
    optional() {
      return {
        inner: this,
        [symbolOptionalDependency]: true,
      } as IOptionalDependency<
        ITask<Input, Output, Deps, TMeta, TTags, TMiddleware>
      >;
    },
  };
}

defineTask.phantom = <Input = undefined, Output extends Promise<any> = any>(
  taskConfig: Omit<ITaskDefinition<Input, Output, any, any, any, any>, "run">,
) => {
  const taskDef = defineTask({
    ...taskConfig,
    run: async (input: any): Promise<any> => {
      return undefined;
    },
  });

  taskDef[symbolPhantomTask] = true;

  return taskDef as IPhantomTask<Input, Output, any, any, any, any>;
};
