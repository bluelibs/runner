import { getRunner, RequestCtx, createUser } from "../bootstrap";
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

export const handler = async (
  event: any,
  context: any,
): Promise<APIGatewayProxyResult> => {
  const rr: any = await getRunner();
  const rawBody = event?.body
    ? event?.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body
    : undefined;
  const body = rawBody ? JSON.parse(rawBody) : undefined;

  return RequestCtx.provide(
    {
      requestId: context?.awsRequestId ?? "local",
      method:
        event?.requestContext?.http?.method ?? event?.httpMethod ?? "POST",
      path: event?.rawPath || event?.path || "/",
      headers: event?.headers || {},
    },
    async () => {
      try {
        const parsed = CreateUserSchema.safeParse({ name: body?.name });
        if (!parsed.success) {
          return json(400, {
            message: "Invalid body",
            issues: parsed.error.issues,
          });
        }
        const created = await rr.runTask(createUser, parsed.data);
        return json(201, created);
      } catch (err: any) {
        return json(500, { message: "Internal error", error: String(err) });
      }
    },
  );
};
