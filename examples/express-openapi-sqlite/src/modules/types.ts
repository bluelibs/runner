import z from "zod";

export interface HttpRouteConfig {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  requiresAuth?: boolean;
  paramsSchema?: z.ZodSchema;
  querySchema?: z.ZodSchema;
  requestBodySchema?: z.ZodSchema;
  responseSchema?: z.ZodSchema;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
