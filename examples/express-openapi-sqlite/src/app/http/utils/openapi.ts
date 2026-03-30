import { Match } from "@bluelibs/runner";
import type { ValidationSchemaInput } from "@bluelibs/runner/defs";
import type { HttpRouteConfig } from "../types";

function stripSchemaMarkers(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stripSchemaMarkers);

  const copy: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    if (key === "$schema") continue;
    copy[key] = stripSchemaMarkers(child);
  }

  return copy;
}

function toOpenApiSchema(
  schema?: ValidationSchemaInput,
): Record<string, unknown> | undefined {
  if (!schema) return undefined;

  if (
    typeof schema === "object" &&
    schema !== null &&
    "toJSONSchema" in schema &&
    typeof schema.toJSONSchema === "function"
  ) {
    return stripSchemaMarkers(schema.toJSONSchema()) as Record<string, unknown>;
  }

  return stripSchemaMarkers(Match.toJSONSchema(schema as never)) as Record<
    string,
    unknown
  >;
}

function toParameters(
  schema: Record<string, unknown> | undefined,
  location: "path" | "query",
) {
  const properties =
    schema?.properties && typeof schema.properties === "object"
      ? Object.entries(schema.properties as Record<string, unknown>)
      : [];
  const required = new Set(
    Array.isArray(schema?.required)
      ? schema.required.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );

  return properties.map(([name, parameterSchema]) => ({
    in: location,
    name,
    required: location === "path" || required.has(name),
    schema: parameterSchema,
  }));
}

function buildOpenApiResponses(
  responseSchema: Record<string, unknown> | undefined,
  requiresAuth: boolean | undefined,
) {
  const responses: Record<string, unknown> = {
    "200": {
      description: "OK",
      content: responseSchema
        ? { "application/json": { schema: responseSchema } }
        : undefined,
    },
    "400": {
      description: "Bad Request",
    },
    "500": {
      description: "Internal Server Error",
    },
  };

  if (requiresAuth) {
    responses["401"] = {
      description: "Unauthorized",
    };
  }

  return responses;
}

export function toOpenApiPath(path: string) {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

export function buildOpenApiOperation({
  method,
  summary,
  description,
  tags,
  requiresAuth,
  paramsSchema,
  querySchema,
  requestBodySchema,
  responseSchema,
}: HttpRouteConfig): Record<string, unknown> {
  const parameters = [
    ...toParameters(toOpenApiSchema(paramsSchema), "path"),
    ...toParameters(toOpenApiSchema(querySchema), "query"),
  ];
  const requestBody = toOpenApiSchema(requestBodySchema);
  const response = toOpenApiSchema(responseSchema);
  const operation: Record<string, unknown> = {
    summary,
    description,
    tags,
    responses: buildOpenApiResponses(response, requiresAuth),
  };

  if (requiresAuth) {
    operation.security = [{ BearerAuth: [] }];
  }

  if (parameters.length > 0) {
    operation.parameters = parameters;
  }

  if (requestBody && method !== "GET") {
    operation.requestBody = {
      content: { "application/json": { schema: requestBody } },
    };
  }

  return operation;
}

export function buildOpenApiSpec(
  paths: Record<string, Record<string, unknown>>,
  port: number,
) {
  return {
    openapi: "3.1.0",
    info: {
      title: "BlueLibs Runner Express API",
      version: "1.0.0",
      description:
        "A complete Express app with authentication using BlueLibs Runner",
    },
    servers: [
      { url: `http://localhost:${port}`, description: "Development server" },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT Authentication",
        },
      },
    },
    paths,
  };
}
