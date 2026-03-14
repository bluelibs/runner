import { createUser } from "../bootstrap";
import {
  json,
  parseEvent,
  errorToResponse,
  APIGatewayProxyResult,
} from "../http";
import { withRunnerRequestContext } from "../lambda";
import { AnyApiGatewayEvent, LambdaContextLike } from "../types/aws";

export const handler = async (
  event: AnyApiGatewayEvent,
  context: LambdaContextLike,
): Promise<APIGatewayProxyResult> => {
  const request = parseEvent<{ name?: string }>(event);

  return withRunnerRequestContext(request, context, async ({ request, runtime }) => {
    try {
      const created = await runtime.runTask(createUser, {
        name: request.body?.name ?? "",
      });
      return json(201, created);
    } catch (error: unknown) {
      return errorToResponse(error, { validationMessage: "Invalid body" });
    }
  });
};
