import { getRunner, RequestCtx, getUser, createUser } from "./bootstrap";
import {
  json,
  parseEvent,
  preflight,
  errorToResponse,
  APIGatewayProxyResult,
} from "./http";
import { z } from "zod";

const CreateUserSchema = z.object({ name: z.string().min(1) });
const GetUserSchema = z.object({ id: z.string().min(1) });

export const handler = async (
  event: unknown,
  context: { awsRequestId?: string },
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
          const parsed = GetUserSchema.safeParse({ id });
          if (!parsed.success) {
            return json(400, {
              message: "Invalid id",
              issues: parsed.error.issues,
            });
          }
          const user = await rr.runTask(getUser, parsed.data);
          return user ? json(200, user) : json(404, { message: "Not found" });
        }

        if (method === "POST" && path === "/users") {
          const parsed = CreateUserSchema.safeParse({ name: body?.name });
          if (!parsed.success) {
            return json(400, {
              message: "Invalid body",
              issues: parsed.error.issues,
            });
          }
          const created = await rr.runTask(createUser, parsed.data);
          return json(201, created);
        }

        return json(404, { message: "Route not found" });
      } catch (err: unknown) {
        return errorToResponse(err);
      }
    },
  );
};
