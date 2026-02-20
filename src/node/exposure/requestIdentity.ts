import * as crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "http";

const REQUEST_ID_HEADER = "x-runner-request-id";
const REQUEST_ID_MAX_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

function readHeaderValue(
  headers: IncomingMessage["headers"],
  headerName: string,
): string | undefined {
  const raw = headers[headerName];
  if (Array.isArray(raw)) return raw[0];
  if (typeof raw === "string") return raw;
}

function normalizeRequestId(value: string | undefined): string | undefined {
  if (!value) return;
  const trimmed = value.trim();
  if (!trimmed) return;
  if (trimmed.length > REQUEST_ID_MAX_LENGTH) return;
  if (!REQUEST_ID_PATTERN.test(trimmed)) return;
  return trimmed;
}

function createRequestId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString("hex");
}

export function getRequestId(req: IncomingMessage): string | undefined {
  return normalizeRequestId(readHeaderValue(req.headers, REQUEST_ID_HEADER));
}

export function ensureRequestId(
  req: IncomingMessage,
  res: ServerResponse,
): string {
  const requestId = getRequestId(req) ?? createRequestId();
  req.headers[REQUEST_ID_HEADER] = requestId;
  if (!res.headersSent) {
    res.setHeader(REQUEST_ID_HEADER, requestId);
  }
  return requestId;
}
