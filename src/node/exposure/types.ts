import type { IncomingMessage, ServerResponse } from "http";

export type RequestKind = "task" | "event";

export interface RequestTarget {
  kind: RequestKind;
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
