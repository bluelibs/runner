import type { ValidationSchemaInput } from "@bluelibs/runner/defs";

export interface HttpRouteConfig {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  requiresAuth?: boolean;
  paramsSchema?: ValidationSchemaInput;
  querySchema?: ValidationSchemaInput;
  requestBodySchema?: ValidationSchemaInput;
  responseSchema?: ValidationSchemaInput;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
