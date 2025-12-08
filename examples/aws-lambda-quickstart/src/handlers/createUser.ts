import { getRunner, RequestCtx, createUser } from "../bootstrap";
import { json, parseEvent, errorToResponse, APIGatewayProxyResult } from "../http";
import { z } from "zod";

const CreateUserSchema = z.object({ name: z.string().min(1) });

export const handler = async (
  event: unknown,
  context: { awsRequestId?: string },
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
        const parsed = CreateUserSchema.safeParse({ name: body?.name });
        if (!parsed.success) {
          return json(400, { message: "Invalid body", issues: parsed.error.issues });
        }
        const created = await rr.runTask(createUser, parsed.data);
        return json(201, created);
      } catch (err: unknown) {
        return errorToResponse(err);
      }
    },
  );
};
