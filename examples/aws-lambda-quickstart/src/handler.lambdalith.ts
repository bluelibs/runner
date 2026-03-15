import { getUser, createUser } from "./bootstrap";
import {
  json,
  parseEvent,
  preflight,
  errorToResponse,
  APIGatewayProxyResult,
} from "./http";
import { withRunnerRequestContext } from "./lambda";
import { AnyApiGatewayEvent, LambdaContextLike } from "./types/aws";

export const handler = async (
  event: AnyApiGatewayEvent,
  context: LambdaContextLike,
): Promise<APIGatewayProxyResult> => {
  const request = parseEvent<{ name?: string }>(event);
  const { method, path } = request;

  // Handle CORS preflight
  const preflightRes = preflight(method);
  if (preflightRes) return preflightRes;

  return withRunnerRequestContext(request, context, async ({ request, runtime }) => {
    try {
      if (method === "GET" && path.startsWith("/users/")) {
        const id = path.split("/").pop()!;
        const user = await runtime.runTask(getUser, { id });
        return user ? json(200, user) : json(404, { message: "Not found" });
      }

      if (method === "POST" && path === "/users") {
        const created = await runtime.runTask(createUser, {
          name: request.body?.name ?? "",
        });
        return json(201, created);
      }

      return json(404, { message: "Route not found" });
    } catch (error: unknown) {
      const validationMessage =
        method === "GET" && path.startsWith("/users/")
          ? "Invalid id"
          : "Invalid body";

      return errorToResponse(error, { validationMessage });
    }
  });
};
