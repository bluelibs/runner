import { AuthenticatedUserLike } from "./types";

interface RunArgs<TInput = any, TResult = any> {
  taskRunner: { run(task: any, input: TInput): Promise<TResult> };
  task: any;
  input: TInput;
  fastifyContext: any; // context provider (fastifyContext.provide)
  contextValues: {
    request: any;
    reply: any;
    requestId: string;
    user: AuthenticatedUserLike | null;
    userId: string | null;
    logger: any;
  };
  onSuccess(meta: { tookMs: number; statusCode: number }): void;
  onError(meta: { tookMs: number }, err: any): void;
}

export async function runTaskWithHttpContext<TInput, TResult>(
  args: RunArgs<TInput, TResult>,
): Promise<TResult> {
  const {
    taskRunner,
    task,
    input,
    fastifyContext,
    contextValues,
    onSuccess,
    onError,
  } = args;
  const started = Date.now();
  try {
    return await fastifyContext.provide(contextValues, async () => {
      const result = await taskRunner.run(task, input);
      const tookMs = Date.now() - started;
      onSuccess({ tookMs, statusCode: contextValues.reply.statusCode || 200 });
      return result;
    });
  } catch (err: any) {
    const tookMs = Date.now() - started;
    onError({ tookMs }, err);
    throw err;
  }
}
