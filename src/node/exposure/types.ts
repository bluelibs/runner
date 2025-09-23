import type { IncomingMessage, ServerResponse } from "http";

export type RequestKind = "task" | "event" | "discovery";

export interface RequestTarget {
  kind: RequestKind;
  // For discovery, id is not used; keep for compatibility
  id: string;
}

export type JsonBody = { ok: boolean; [key: string]: unknown };

export interface JsonResponse {
  status: number;
  body: JsonBody;
}

export type RequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean>;

export type Authenticator = (
  req: IncomingMessage,
) => { ok: true } | { ok: false; response: JsonResponse };

export interface AllowListGuard {
  ensureTask(id: string): JsonResponse | null;
  ensureEvent(id: string): JsonResponse | null;
}

// Streaming response helpers for tasks that want to stream the HTTP response
export interface StreamingResponse {
  // The readable stream to pipe to the HTTP response
  stream: NodeJS.ReadableStream;
  // Optional HTTP status (default 200)
  status?: number;
  // Optional content type (default application/octet-stream)
  contentType?: string;
  // Optional additional headers
  headers?: Record<string, string>;
}
