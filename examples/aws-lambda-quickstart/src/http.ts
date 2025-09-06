export type APIGatewayProxyResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
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

export function parseEvent<TBody = unknown>(event: any) {
  const method = event?.requestContext?.http?.method ?? event?.httpMethod ?? "GET";
  const path = event?.rawPath || event?.path || "/";
  const headers = event?.headers || {};
  const contentType = String(headers["content-type"] || headers["Content-Type"] || "");
  const rawBody = event?.body
    ? event?.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body
    : undefined;
  const body = (contentType.includes("application/json") && rawBody
    ? safelyParseJSON(rawBody)
    : undefined) as TBody | undefined;

  return { method, path, headers, rawBody, body, contentType } as const;
}

function safelyParseJSON(s: string): unknown | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export function errorToResponse(err: any): APIGatewayProxyResult {
  // Map Runner validation errors to 400; everything else 500
  if (err && (err.name === "ValidationError" || /validation failed/i.test(String(err?.message)))) {
    return json(400, { message: "Invalid input", error: String(err) });
  }
  return json(500, { message: "Internal error", error: String(err) });
}
