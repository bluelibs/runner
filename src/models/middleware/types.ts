import { ITaskMiddlewareExecutionInput } from "../../types/taskMiddleware";
import { IResourceMiddlewareExecutionInput } from "../../types/resourceMiddleware";

/**
 * Interceptor for task middleware execution
 */
export type TaskMiddlewareInterceptor = (
  next: (input: ITaskMiddlewareExecutionInput<any>) => Promise<any>,
  input: ITaskMiddlewareExecutionInput<any>,
) => Promise<any>;

/**
 * Interceptor for resource middleware execution
 */
export type ResourceMiddlewareInterceptor = (
  next: (input: IResourceMiddlewareExecutionInput<any>) => Promise<any>,
  input: IResourceMiddlewareExecutionInput<any>,
) => Promise<any>;
