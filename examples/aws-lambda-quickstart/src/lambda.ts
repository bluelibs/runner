import { getRunner, RequestCtx } from "./bootstrap";
import { ParsedApiGatewayEvent } from "./http";
import { AnyApiGatewayEvent, LambdaContextLike } from "./types/aws";

type RunnerRuntime = Awaited<ReturnType<typeof getRunner>>;

export async function withRunnerRequestContext<TBody, TResult>(
  request: ParsedApiGatewayEvent<TBody>,
  context: LambdaContextLike,
  run: (input: {
    request: ParsedApiGatewayEvent<TBody>;
    runtime: RunnerRuntime;
  }) => Promise<TResult>,
): Promise<TResult> {
  const runtime = await getRunner();

  return RequestCtx.provide(
    {
      requestId: context?.awsRequestId ?? "local",
      method: request.method,
      path: request.path,
      headers: request.headers,
    },
    async () => run({ request, runtime }),
  );
}

export function getPathParam(
  event: AnyApiGatewayEvent,
  ...names: string[]
): string {
  for (const name of names) {
    const value = event.pathParameters?.[name];

    if (value) {
      return value;
    }
  }

  return "";
}
