import type { ITask } from "./task";
import type { ITaskMiddlewareExecutionInput } from "./taskMiddleware";

export type TaskRunnerInterceptor = (
  next: (input: ITaskMiddlewareExecutionInput<any>) => Promise<any>,
  input: ITaskMiddlewareExecutionInput<any>,
) => Promise<any>;

export type TaskRunnerInterceptOptions = {
  when?: (taskDefinition: ITask<any, any, any, any, any, any>) => boolean;
};
