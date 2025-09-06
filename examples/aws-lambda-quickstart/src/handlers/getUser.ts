import { getRunner, RequestCtx, getUser } from "../bootstrap";
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

const GetUserSchema = z.object({ id: z.string().min(1) });

export const handler = async (event: any, context: any): Promise<APIGatewayProxyResult> => {
  const rr: any = await getRunner();
  const id = event?.pathParameters?.id || event?.pathParameters?.userId || "";

  return RequestCtx.provide(
    {
      requestId: context?.awsRequestId ?? "local",
      method: event?.requestContext?.http?.method ?? event?.httpMethod ?? "GET",
      path: event?.rawPath || event?.path || "/",
      headers: event?.headers || {},
    },
    async () => {
      try {
        const parsed = GetUserSchema.safeParse({ id });
        if (!parsed.success) {
          return json(400, { message: "Invalid id", issues: parsed.error.issues });
        }
        const user = await rr.runTask(getUser, parsed.data);
        return user ? json(200, user) : json(404, { message: "Not found" });
      } catch (err: any) {
        return json(500, { message: "Internal error", error: String(err) });
      }
    },
  );
};
