import { getUser } from "../bootstrap";
import {
  json,
  parseEvent,
  errorToResponse,
  APIGatewayProxyResult,
} from "../http";
import { getPathParam, withRunnerRequestContext } from "../lambda";
import { AnyApiGatewayEvent, LambdaContextLike } from "../types/aws";

export const handler = async (
  event: AnyApiGatewayEvent,
  context: LambdaContextLike,
): Promise<APIGatewayProxyResult> => {
  const request = parseEvent(event);
  const id = getPathParam(event, "id", "userId");

  return withRunnerRequestContext(request, context, async ({ runtime }) => {
    try {
      const user = await runtime.runTask(getUser, { id });
      return user ? json(200, user) : json(404, { message: "Not found" });
    } catch (error: unknown) {
      return errorToResponse(error, { validationMessage: "Invalid id" });
    }
  });
};
