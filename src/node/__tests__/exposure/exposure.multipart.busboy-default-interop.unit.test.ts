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
} from "../../exposure/multipart";
import { getDefaultSerializer } from "../../../serializer";
import { PassThrough } from "node:stream";

const serializer = getDefaultSerializer();

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
});
