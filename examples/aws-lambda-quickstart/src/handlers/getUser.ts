import { getRunner, RequestCtx, getUser } from "../bootstrap";
import {
  json,
  parseEvent,
  errorToResponse,
  APIGatewayProxyResult,
} from "../http";
import { AnyApiGatewayEvent, LambdaContextLike } from "../types/aws";
import { getUserSchema, getValidationIssues } from "../validation";

export const handler = async (
  event: AnyApiGatewayEvent,
  context: LambdaContextLike,
): Promise<APIGatewayProxyResult> => {
  const rr = await getRunner();
  const id = event.pathParameters?.id || event.pathParameters?.userId || "";
  const { method, path, headers } = parseEvent(event);

  return RequestCtx.provide(
    {
      requestId: context?.awsRequestId ?? "local",
      method,
      path,
      headers,
    },
    async () => {
      try {
        const parsed = getUserSchema.parse({ id });

        const user = await rr.runTask(getUser, parsed);
        return user ? json(200, user) : json(404, { message: "Not found" });
      } catch (error: unknown) {
        if (
          error &&
          typeof error === "object" &&
          "failures" in error &&
          Array.isArray((error as { failures?: unknown }).failures)
        ) {
          return json(400, {
            message: "Invalid id",
            issues: getValidationIssues(error),
          });
        }

        return errorToResponse(error);
      }
    },
  );
};
