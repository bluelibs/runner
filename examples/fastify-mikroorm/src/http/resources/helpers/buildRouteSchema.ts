import { z } from "zod";
import { HttpRouteConfig, TaskWithSchemas } from "./types";

interface RouteSchema {
  body?: any;
  response?: Record<number, any>;
}

// Remove $schema marker to keep Fastify/OpenAPI integrations cleaner.
function stripSchemaMarkers(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(stripSchemaMarkers);
  const copy: any = {};
  for (const k of Object.keys(obj)) {
    if (k === "$schema") continue;
    copy[k] = stripSchemaMarkers(obj[k]);
  }
  return copy;
}

export function buildRouteSchema(
  task: TaskWithSchemas,
  config: HttpRouteConfig,
): RouteSchema {
  const routeSchema: RouteSchema = {};
  try {
    const { inputSchema, resultSchema } = task as TaskWithSchemas;
    if (inputSchema && config.method.toLowerCase() !== "get") {
      routeSchema.body = stripSchemaMarkers(z.toJSONSchema(inputSchema));
    }
    if (resultSchema) {
      routeSchema.response = {
        200: stripSchemaMarkers(z.toJSONSchema(resultSchema)),
      };
    }
  } catch {
    // Silently ignore schema build issues (same behavior as original inline try/catch)
  }
  return routeSchema;
}
