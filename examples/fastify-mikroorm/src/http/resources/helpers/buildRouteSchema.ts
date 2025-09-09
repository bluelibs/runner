import { z } from "zod";
import { HttpRouteConfig, TaskWithSchemas } from "./types";

interface RouteSchema {
  body?: any;
  response?: Record<number, any>;
  summary?: string;
  description?: string;
  params?: any;
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
  // Attach meta information for Swagger (if present)
  if (task?.meta?.title) routeSchema.summary = task.meta.title;
  if (task?.meta?.description) routeSchema.description = task.meta.description;
  try {
    const { inputSchema, resultSchema } = task as TaskWithSchemas;
    if (inputSchema && config.method.toLowerCase() !== "get") {
      routeSchema.body = stripSchemaMarkers(z.toJSONSchema(inputSchema));
    }
    // Build path params schema if route contains params like /user/:id
    const paramNames = (config.path.match(/:([A-Za-z0-9_]+)/g) || []).map((m) =>
      m.slice(1),
    );
    if (paramNames.length) {
      const properties: Record<string, any> = {};
      const required: string[] = [];
      let json: any = undefined;
      try {
        if (inputSchema) json = z.toJSONSchema(inputSchema);
      } catch {
        // ignore
      }
      for (const name of paramNames) {
        required.push(name);
        const prop = json?.properties?.[name];
        properties[name] = prop ? stripSchemaMarkers(prop) : { type: "string" };
      }
      routeSchema.params = { type: "object", properties, required };
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
