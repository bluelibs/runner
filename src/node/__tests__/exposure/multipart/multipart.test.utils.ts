import type { IncomingHttpHeaders } from "http";
import { Readable } from "stream";
import { type MultipartRequest } from "../../../exposure/multipart";
import type { JsonResponse } from "../../../exposure/types";
import type { InputFile } from "../../../../types/inputFile";

export const CRLF = "\r\n";

export function createMultipartRequest(
  boundary: string,
  parts: string[],
  extraHeaders: IncomingHttpHeaders = {},
): MultipartRequest {
  const body = parts.join("") + `--${boundary}--${CRLF}`;
  const stream = new Readable({
    read() {
      this.push(Buffer.from(body, "utf8"));
      this.push(null);
    },
  });

  const headers: IncomingHttpHeaders = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "content-length": Buffer.byteLength(body).toString(),
    ...extraHeaders,
  };

  return Object.assign(stream, {
    headers,
    method: "POST" as const,
  });
}

export function createRequestFromBody(
  payload: string,
  headers: IncomingHttpHeaders,
): MultipartRequest {
  const stream = new Readable({
    read() {
      this.push(Buffer.from(payload, "utf8"));
      this.push(null);
    },
  });

  return Object.assign(stream, {
    headers,
    method: "POST" as const,
  });
}

export function createErroringRequest(
  boundary: string,
  error: Error,
): MultipartRequest {
  const stream = new Readable({
    read() {
      setImmediate(() => {
        stream.emit("error", error);
        stream.push(null);
      });
    },
  });

  const headers: IncomingHttpHeaders = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
  };

  return Object.assign(stream, {
    headers,
    method: "POST" as const,
  });
}

export function part(boundary: string, headers: string[], body: string): string {
  return `--${boundary}${CRLF}${headers.join(
    CRLF,
  )}${CRLF}${CRLF}${body}${CRLF}`;
}

export function assertInputFile(
  value: unknown,
  label: string,
): asserts value is InputFile {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} is not an object`);
  }
  const candidate = value as {
    name?: unknown;
    resolve?: unknown;
    stream?: unknown;
    toTempFile?: unknown;
  };
  if (typeof candidate.name !== "string") {
    throw new Error(`${label} is missing required name`);
  }
  if (typeof candidate.resolve !== "function") {
    throw new Error(`${label} is missing resolve()`);
  }
  if (typeof candidate.stream !== "function") {
    throw new Error(`${label} is missing stream()`);
  }
  if (typeof candidate.toTempFile !== "function") {
    throw new Error(`${label} is missing toTempFile()`);
  }
}

export function expectErrorCode(response: JsonResponse, expected: string): void {
  const body = response.body;
  if (!body || typeof body !== "object") {
    throw new Error("Error response body is missing");
  }
  const error = (body as { error?: { code?: unknown } }).error;
  if (!error || typeof error !== "object") {
    throw new Error("Error payload is missing details");
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string") {
    throw new Error("Error code is not a string");
  }
  expect(code).toBe(expected);
}
