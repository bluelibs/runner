import { getRunner, RequestCtx, getUser } from "../bootstrap";
import { json, parseEvent, errorToResponse, APIGatewayProxyResult } from "../http";
import { z } from "zod";

const GetUserSchema = z.object({ id: z.string().min(1) });

interface LambdaEvent {
  pathParameters?: { id?: string; userId?: string };
  requestContext?: { http?: { method?: string } };
  httpMethod?: string;
  rawPath?: string;
  path?: string;
  headers?: Record<string, string>;
}

export const handler = async (
  event: LambdaEvent,
  context: { awsRequestId?: string },
): Promise<APIGatewayProxyResult> => {
  const rr = await getRunner();
  const id = event?.pathParameters?.id || event?.pathParameters?.userId || "";
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
        const parsed = GetUserSchema.safeParse({ id });
        if (!parsed.success) {
          return json(400, {
            message: "Invalid id",
            issues: parsed.error.issues,
          });
        }
        const user = await rr.runTask(getUser, parsed.data);
        return user ? json(200, user) : json(404, { message: "Not found" });
      } catch (err: unknown) {
        return errorToResponse(err);
      }
    },
  );
};
