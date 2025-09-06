import { getRunner, RequestCtx, getUser, createUser } from "./bootstrap";
import { z } from "zod";

type APIGatewayProxyResult = {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
};

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(body ?? null),
  };
}

const CreateUserSchema = z.object({ name: z.string().min(1) });
const GetUserSchema = z.object({ id: z.string().min(1) });

export const handler = async (event: any, context: any): Promise<APIGatewayProxyResult> => {
  const rr: any = await getRunner();

  const method = event?.requestContext?.http?.method ?? event?.httpMethod ?? "GET";
  const path = event?.rawPath || event?.path || "/";
  const headers = event?.headers || {};
  const rawBody = event?.body
    ? event?.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body
    : undefined;
  const body = rawBody ? JSON.parse(rawBody) : undefined;

  // Preflight CORS
  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
      body: "",
    };
  }

  return RequestCtx.provide(
    { requestId: context?.awsRequestId ?? "local", method, path, headers },
    async () => {
      try {
        if (method === "GET" && path.startsWith("/users/")) {
          const id = path.split("/").pop()!;
          const parsed = GetUserSchema.safeParse({ id });
          if (!parsed.success) {
            return json(400, { message: "Invalid id", issues: parsed.error.issues });
          }
          const user = await rr.runTask(getUser, parsed.data);
          return user ? json(200, user) : json(404, { message: "Not found" });
        }

        if (method === "POST" && path === "/users") {
          const parsed = CreateUserSchema.safeParse({ name: body?.name });
          if (!parsed.success) {
            return json(400, { message: "Invalid body", issues: parsed.error.issues });
          }
          const created = await rr.runTask(createUser, parsed.data);
          return json(201, created);
        }

        return json(404, { message: "Route not found" });
      } catch (err: any) {
        return json(500, { message: "Internal error", error: String(err) });
      }
    },
  );
};
