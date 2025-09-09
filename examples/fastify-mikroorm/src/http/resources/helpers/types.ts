import { z } from "zod";

// Basic route config shape extracted from httpRoute tag.
export interface HttpRouteConfig {
  method: string; // GET, POST, etc.
  path: string;
  auth?: HttpAuthMode; // 'public' | 'required'
  inputFrom?: HttpInputFrom; // 'body' | 'merged'
}

export type HttpAuthMode = "public" | "required" | "optional";
export type HttpInputFrom = "body" | "merged";

// Task with optional attached zod schemas (convention used in examples)
export interface TaskWithSchemas<I = any, R = any> {
  inputSchema?: z.ZodTypeAny;
  resultSchema?: z.ZodTypeAny;
  meta?: {
    title?: string;
    description?: string;
  };
  // Other fields are kept loose to avoid coupling with runner internals.
  [k: string]: any; // fallback
}

export interface AuthenticatedUserLike {
  id: string;
  name?: string | null;
  email?: string | null;
  [k: string]: any;
}
