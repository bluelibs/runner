import { getRunner, RequestCtx, getUser, createUser } from "./bootstrap";
import {
  json,
  parseEvent,
  preflight,
  errorToResponse,
  APIGatewayProxyResult,
} from "./http";
import { AnyApiGatewayEvent, LambdaContextLike } from "./types/aws";
import {
  createUserSchema,
  getUserSchema,
  getValidationIssues,
} from "./validation";

export const handler = async (
  event: AnyApiGatewayEvent,
  context: LambdaContextLike,
): Promise<APIGatewayProxyResult> => {
  const { method, path, headers, body } = parseEvent<{ name?: string }>(event);

  // Handle CORS preflight
  const preflightRes = preflight(method);
  if (preflightRes) return preflightRes;

  const rr = await getRunner();

  return RequestCtx.provide(
    { requestId: context?.awsRequestId ?? "local", method, path, headers },
    async () => {
      try {
        if (method === "GET" && path.startsWith("/users/")) {
          const id = path.split("/").pop()!;
          const parsed = getUserSchema.parse({ id });

          const user = await rr.runTask(getUser, parsed);
          return user ? json(200, user) : json(404, { message: "Not found" });
        }

        if (method === "POST" && path === "/users") {
          const parsed = createUserSchema.parse({ name: body?.name });

          const created = await rr.runTask(createUser, parsed);
          return json(201, created);
        }

        return json(404, { message: "Route not found" });
      } catch (error: unknown) {
        if (
          error &&
          typeof error === "object" &&
          "failures" in error &&
          Array.isArray((error as { failures?: unknown }).failures)
        ) {
          const isGetRoute = method === "GET" && path.startsWith("/users/");

          return json(400, {
            message: isGetRoute ? "Invalid id" : "Invalid body",
            issues: getValidationIssues(error),
          });
        }

        return errorToResponse(error);
      }
    },
  );
};
