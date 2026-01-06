import type { IncomingHttpHeaders } from "http";
import { Readable } from "stream";

import {
  parseMultipartInput,
  type MultipartRequest,
} from "../exposure/multipart";
import { getDefaultSerializer } from "../../serializer";
import type { JsonResponse } from "../exposure/types";
import type { InputFile } from "../../types/inputFile";

const serializer = getDefaultSerializer();

const CRLF = "\r\n";

function createMultipartRequest(
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

function createRequestFromBody(
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

function createErroringRequest(
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

function part(boundary: string, headers: string[], body: string): string {
  return `--${boundary}${CRLF}${headers.join(
    CRLF,
  )}${CRLF}${CRLF}${body}${CRLF}`;
}

function assertInputFile(
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

function assertFilePair(
  value: unknown,
): asserts value is { fileA: InputFile; fileB: InputFile } {
  if (!value || typeof value !== "object") {
    throw new Error("Expected multipart value to contain files");
  }
  const record = value as { fileA?: unknown; fileB?: unknown };
  assertInputFile(record.fileA, "fileA");
  assertInputFile(record.fileB, "fileB");
}

function expectErrorCode(response: JsonResponse, expected: string): void {
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

describe("parseMultipartInput", () => {
  const boundary = "----jest-boundary";

  it("hydrates manifest input, skips unrelated fields, and preserves manifest metadata", async () => {
    const manifest = JSON.stringify({
      input: {
        fileA: {
          $runnerFile: "File",
          id: "A",
          meta: {
            name: "override.txt",
            type: "text/plain",
            lastModified: 123,
            extra: { kind: "manifest" },
          },
        },
        fileB: {
          $runnerFile: "File",
          id: "B",
          meta: { name: "placeholder.bin" },
        },
      },
    });
    const req = createMultipartRequest(boundary, [
      part(
        boundary,
        ['Content-Disposition: form-data; name="ignored"'],
        "noop",
      ),
      part(
        boundary,
        [
          'Content-Disposition: form-data; name="__manifest"',
          "Content-Type: application/json; charset=utf-8",
        ],
        manifest,
      ),
      part(
        boundary,
        [
          'Content-Disposition: form-data; name="file:A"; filename="foo.txt"',
          "Content-Type: application/octet-stream",
        ],
        "abc",
      ),
      part(
        boundary,
        [
          'Content-Disposition: form-data; name="file:B"; filename="bar.bin"',
          "Content-Type: application/octet-stream",
        ],
        "xyz",
      ),
    ]);

    const parsed = await parseMultipartInput(req, undefined, serializer);
    if (!parsed.ok) {
      throw new Error("Expected multipart success");
    }

    assertFilePair(parsed.value);
    const { fileA, fileB } = parsed.value;

    expect(fileA.name).toBe("override.txt");
    expect(fileA.type).toBe("text/plain");
    expect(fileA.lastModified).toBe(123);
    expect(fileA.extra).toEqual({ kind: "manifest" });
    expect(fileB.name).toBe("placeholder.bin");
    expect(fileB.type).toBe("application/octet-stream");

    const finalize = await parsed.finalize;
    expect(finalize.ok).toBe(true);
  });

  it("fails when manifest is missing", async () => {
    const req = createMultipartRequest(boundary, [
      part(
        boundary,
        [
          'Content-Disposition: form-data; name="file:A"; filename="foo.txt"',
          "Content-Type: application/octet-stream",
        ],
        "abc",
      ),
    ]);

    const parsed = await parseMultipartInput(req, undefined, serializer);
    if (parsed.ok) {
      throw new Error("Expected multipart failure for missing manifest");
    }

    expectErrorCode(parsed.response, "MISSING_MANIFEST");
  });

  it("fails when manifest JSON is invalid", async () => {
    const req = createMultipartRequest(boundary, [
      part(
        boundary,
        [
          'Content-Disposition: form-data; name="__manifest"',
          "Content-Type: application/json; charset=utf-8",
        ],
        "not-json",
      ),
    ]);

    const parsed = await parseMultipartInput(req, undefined, serializer);
    if (parsed.ok) {
      throw new Error("Expected multipart failure for invalid manifest");
    }

    expectErrorCode(parsed.response, "INVALID_MULTIPART");
  });

  it("propagates request stream errors", async () => {
    const req = createErroringRequest(boundary, new Error("boom"));

    const parsed = await parseMultipartInput(req, undefined, serializer);
    if (parsed.ok) {
      const finalize = await parsed.finalize;
      if (finalize.ok) {
        throw new Error("Expected finalize to report request abort");
      }
      expectErrorCode(finalize.response, "REQUEST_ABORTED");
      return;
    }
    expectErrorCode(parsed.response, "REQUEST_ABORTED");
  });

  it("reports multipart parser errors (missing boundary)", async () => {
    const req = createRequestFromBody("irrelevant", {
      "content-type": "multipart/form-data",
    });

    const parsed = await parseMultipartInput(req, undefined, serializer);
    if (parsed.ok) {
      const finalize = await parsed.finalize;
      if (finalize.ok) {
        throw new Error("Expected missing boundary to be treated as invalid");
      }
      expectErrorCode(finalize.response, "INVALID_MULTIPART");
      return;
    }
    expectErrorCode(parsed.response, "INVALID_MULTIPART");
  });

  it("finalize surfaces missing file part errors", async () => {
    const manifest = JSON.stringify({
      input: {
        file: { $runnerFile: "File", id: "F1", meta: { name: "late.txt" } },
      },
    });
    const req = createMultipartRequest(boundary, [
      part(
        boundary,
        [
          'Content-Disposition: form-data; name="__manifest"',
          "Content-Type: application/json; charset=utf-8",
        ],
        manifest,
      ),
    ]);

    const parsed = await parseMultipartInput(req, undefined, serializer);
    if (!parsed.ok) {
      throw new Error("Expected success before finalize");
    }
    const finalize = await parsed.finalize;
    if (finalize.ok) {
      throw new Error("Expected finalize to report missing file part");
    }
    expectErrorCode(finalize.response, "MISSING_FILE_PART");
  });
});
