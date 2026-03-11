import { getRunner, RequestCtx, createUser } from "../bootstrap";
import {
  json,
  parseEvent,
  errorToResponse,
  APIGatewayProxyResult,
} from "../http";
import { AnyApiGatewayEvent, LambdaContextLike } from "../types/aws";
import { createUserSchema, getValidationIssues } from "../validation";

export const handler = async (
  event: AnyApiGatewayEvent,
  context: LambdaContextLike,
): Promise<APIGatewayProxyResult> => {
  const rr = await getRunner();
  const { method, path, headers, body } = parseEvent<{ name?: string }>(event);

  return RequestCtx.provide(
    {
      requestId: context?.awsRequestId ?? "local",
      method,
      path,
      headers,
    },
    async () => {
      try {
        const parsed = createUserSchema.parse({ name: body?.name });

        const created = await rr.runTask(createUser, parsed);
        return json(201, created);
      } catch (error: unknown) {
        if (
          error &&
          typeof error === "object" &&
          "failures" in error &&
          Array.isArray((error as { failures?: unknown }).failures)
        ) {
          return json(400, {
            message: "Invalid body",
            issues: getValidationIssues(error),
          });
        }

        return errorToResponse(error);
      }
    },
  );
};
