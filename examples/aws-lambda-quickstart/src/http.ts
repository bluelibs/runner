import { AnyApiGatewayEvent } from "./types/aws";
import { getValidationIssues, isValidationError } from "./validation";

export type APIGatewayProxyResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

export type ParsedApiGatewayEvent<TBody = unknown> = {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  rawBody: string | undefined;
  body: TBody | undefined;
  contentType: string;
};

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

export function json(
  statusCode: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      ...corsHeaders,
      ...(extraHeaders || {}),
    },
    body: JSON.stringify(body ?? null),
  };
}

export function preflight(method: string): APIGatewayProxyResult | null {
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: { ...corsHeaders }, body: "" };
  }
  return null;
}

export function parseEvent<TBody = unknown>(
  event: AnyApiGatewayEvent,
): ParsedApiGatewayEvent<TBody> {
  const method =
    event?.requestContext?.http?.method ?? event?.httpMethod ?? "GET";
  const path = event?.rawPath || event?.path || "/";
  const headers = event?.headers ?? {};
  const contentType = String(
    headers["content-type"] || headers["Content-Type"] || "",
  );
  const rawBody = event?.body
    ? event?.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body
    : undefined;
  const body = (
    contentType.includes("application/json") && rawBody
      ? safelyParseJSON(rawBody)
      : undefined
  ) as TBody | undefined;

  return { method, path, headers, rawBody, body, contentType };
}

function safelyParseJSON(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function errorToResponse(
  err: unknown,
  options?: { validationMessage?: string },
): APIGatewayProxyResult {
  const message =
    err && typeof err === "object" && "message" in err
      ? String(err.message)
      : String(err);

  if (isValidationError(err)) {
    return json(400, {
      message: options?.validationMessage ?? "Invalid input",
      issues: getValidationIssues(err),
    });
  }

  // Map other validation-shaped errors to 400; everything else 500
  if (
    err &&
    typeof err === "object" &&
    "name" in err &&
    (err.name === "ValidationError" || /validation failed/i.test(message))
  ) {
    return json(400, {
      message: options?.validationMessage ?? "Invalid input",
      error: message,
    });
  }

  return json(500, { message: "Internal error", error: message });
}
