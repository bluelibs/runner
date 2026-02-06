import type { IncomingHttpHeaders } from "http";

let defaultFactoryCalls = 0;

jest.mock("busboy", () => {
  class FakeBusboy {
    private handlers: Record<string, Function[]> = Object.create(null);

    on(event: string, cb: Function) {
      (this.handlers[event] ??= []).push(cb);
      return this;
    }

    once(event: string, cb: Function) {
      const wrapper = (...args: any[]) => {
        this.handlers[event] = (this.handlers[event] ?? []).filter(
          (f) => f !== wrapper,
        );
        cb(...args);
      };
      (this.handlers[event] ??= []).push(wrapper);
      return this;
    }

    emit(event: string, ...args: any[]) {
      for (const cb of this.handlers[event] ?? []) {
        cb(...args);
      }
    }
  }

  return {
    __esModule: true,
    default: (_cfg: { headers: IncomingHttpHeaders }) => {
      defaultFactoryCalls += 1;
      return new FakeBusboy();
    },
  };
});

import {
  parseMultipartInput,
  type MultipartRequest,
} from "../../../exposure/multipart";
import { Serializer } from "../../../../serializer";
import { PassThrough } from "node:stream";
import { NodeInputFile } from "../../../files/inputFile.model";

const serializer = new Serializer();

function createMockRequest(
  headers: IncomingHttpHeaders,
  scenario: (busboy: any, req: any) => void,
): MultipartRequest {
  const req: any = {
    headers,
    method: "POST" as const,
    on() {
      return req;
    },
    unpipe() {},
    resume() {},
    pipe(busboy: any) {
      scenario(busboy, req);
      return req;
    },
  };
  return req;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

describe("parseMultipartInput - busboy default export interop", () => {
  it("uses busboy.default when present", async () => {
    defaultFactoryCalls = 0;

    const boundary = "----unit-busboy-default-boundary";
    const req = createMockRequest(
      {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      (busboy) => {
        busboy.emit(
          "field",
          "__manifest",
          JSON.stringify({ input: { a: 1 } }),
          {
            nameTruncated: false,
            valueTruncated: false,
            encoding: "7bit",
            mimeType: "text/plain",
          },
        );
        busboy.emit("finish");
      },
    );

    const parsed = await parseMultipartInput(req, undefined, serializer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected multipart parsing to succeed");
    }

    await expect(parsed.finalize).resolves.toEqual({ ok: true });
    expect(parsed.value).toEqual({ a: 1 });
    expect(defaultFactoryCalls).toBe(1);
  });

  it("rejects truncated manifest fields with a 413 payload-too-large response", async () => {
    const boundary = "----unit-busboy-default-boundary-truncated";
    const req = createMockRequest(
      {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      (busboy) => {
        busboy.emit("field", "__manifest", "{", {
          nameTruncated: true,
          valueTruncated: false,
          encoding: "7bit",
          mimeType: "text/plain",
        });
      },
    );

    const parsed = await parseMultipartInput(req, undefined, serializer);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) {
      throw new Error("Expected multipart parsing to fail");
    }
    expect(parsed.response.status).toBe(413);
    expect(
      (parsed.response.body as unknown as { error: { message: string } }).error
        .message,
    ).toBe("Field limit exceeded");
  });

  it("propagates file size limit via finalize() after manifest is accepted", async () => {
    const boundary = "----unit-busboy-default-boundary-file-limit";
    const req = createMockRequest(
      {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      (busboy) => {
        busboy.emit(
          "field",
          "__manifest",
          JSON.stringify({
            input: { file: { $runnerFile: "File", id: "F1" } },
          }),
          {
            nameTruncated: false,
            valueTruncated: false,
            encoding: "7bit",
            mimeType: "text/plain",
          },
        );

        const stream = new PassThrough();
        busboy.emit("file", "file:F1", stream, {
          filename: "a.txt",
          mimeType: "text/plain",
          encoding: "7bit",
        });
        stream.emit("limit");
      },
    );

    const parsed = await parseMultipartInput(req, undefined, serializer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected multipart parsing to succeed");
    }
    const finalized = await parsed.finalize;
    expect(finalized.ok).toBe(false);
    if (finalized.ok) {
      throw new Error("Expected finalize() to fail");
    }
    expect(finalized.response.status).toBe(413);
    expect(
      (finalized.response.body as unknown as { error: { message: string } })
        .error.message,
    ).toBe("File size limit exceeded");
  });

  it("propagates fields/files/parts limits via finalize() after manifest is accepted", async () => {
    const boundary = "----unit-busboy-default-boundary-limits";
    const req = createMockRequest(
      {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      (busboy) => {
        busboy.emit(
          "field",
          "__manifest",
          JSON.stringify({ input: { a: 1 } }),
          {
            nameTruncated: false,
            valueTruncated: false,
            encoding: "7bit",
            mimeType: "text/plain",
          },
        );
        busboy.emit("fieldsLimit");
        busboy.emit("filesLimit");
        busboy.emit("partsLimit");
      },
    );

    const parsed = await parseMultipartInput(req, undefined, serializer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected multipart parsing to succeed");
    }
    const finalized = await parsed.finalize;
    expect(finalized.ok).toBe(false);
    if (finalized.ok) {
      throw new Error("Expected finalize() to fail");
    }
    expect(finalized.response.status).toBe(413);
    expect(
      (finalized.response.body as unknown as { error: { code: string } }).error
        .code,
    ).toBe("PAYLOAD_TOO_LARGE");
  });

  it("applies size/lastModified/extra from file info when missing in manifest", async () => {
    const boundary = "----unit-busboy-default-boundary-file-meta-merge";
    const fileId = "F1";

    const manifest = JSON.stringify({
      input: {
        file: {
          $runnerFile: "File",
          id: fileId,
          meta: { name: "from-manifest.txt" },
        },
      },
    });

    const req = createMockRequest(
      {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      (busboy) => {
        busboy.emit("field", "__manifest", manifest, {
          nameTruncated: false,
          valueTruncated: false,
          encoding: "7bit",
          mimeType: "text/plain",
        });

        const upstream = new PassThrough();
        busboy.emit("file", `file:${fileId}`, upstream, {
          filename: "from-stream.txt",
          mimeType: "text/plain",
          encoding: "7bit",
          size: 123,
          lastModified: 456,
          extra: { a: 1 },
        });
        upstream.end();
        busboy.emit("finish");
      },
    );

    const parsed = await parseMultipartInput(req, undefined, serializer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected multipart parsing to succeed");
    }

    await expect(parsed.finalize).resolves.toEqual({ ok: true });

    const value = parsed.value;
    if (!isRecord(value)) {
      throw new Error("Expected parsed.value to be an object");
    }
    const file = value.file;
    if (!(file instanceof NodeInputFile)) {
      throw new Error("Expected parsed.value.file to be a NodeInputFile");
    }
    expect(file.name).toBe("from-manifest.txt");
    expect(file.size).toBe(123);
    expect(file.lastModified).toBe(456);
    expect(file.extra).toEqual({ a: 1 });
  });

  it("does not override manifest meta with file info", async () => {
    const boundary = "----unit-busboy-default-boundary-file-meta-no-override";
    const fileId = "F1";

    const manifest = JSON.stringify({
      input: {
        file: {
          $runnerFile: "File",
          id: fileId,
          meta: {
            name: "manifest-name.txt",
            type: "text/plain",
            size: 111,
            lastModified: 222,
            extra: { k: "v" },
          },
        },
      },
    });

    const req = createMockRequest(
      {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      (busboy) => {
        busboy.emit("field", "__manifest", manifest, {
          nameTruncated: false,
          valueTruncated: false,
          encoding: "7bit",
          mimeType: "text/plain",
        });

        const upstream = new PassThrough();
        busboy.emit("file", `file:${fileId}`, upstream, {
          filename: "stream-name.txt",
          mimeType: "application/octet-stream",
          encoding: "7bit",
          size: 999,
          lastModified: 888,
          extra: { k: "override" },
        });
        upstream.end();
        busboy.emit("finish");
      },
    );

    const parsed = await parseMultipartInput(req, undefined, serializer);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("Expected multipart parsing to succeed");
    }

    await expect(parsed.finalize).resolves.toEqual({ ok: true });

    const value = parsed.value;
    if (!isRecord(value)) {
      throw new Error("Expected parsed.value to be an object");
    }
    const file = value.file;
    if (!(file instanceof NodeInputFile)) {
      throw new Error("Expected parsed.value.file to be a NodeInputFile");
    }

    expect(file.name).toBe("manifest-name.txt");
    expect(file.size).toBe(111);
    expect(file.lastModified).toBe(222);
    expect(file.extra).toEqual({ k: "v" });
    expect(file.type).toBe("text/plain");
  });
});
