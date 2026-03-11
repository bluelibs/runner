export type MiddlewareKeyBuilder = (taskId: string, input: unknown) => string;

export const defaultTaskKeyBuilder: MiddlewareKeyBuilder = (taskId) => taskId;
