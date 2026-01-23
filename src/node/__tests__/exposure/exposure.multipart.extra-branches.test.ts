import type { IncomingHttpHeaders } from "http";
import { PassThrough } from "node:stream";

import type { FileInfo } from "busboy";

// We mock only for this test file; other suites use the real busboy
jest.mock("busboy", () => {
  class FakeBusboy {
    private handlers: Record<string, Function[]> = Object.create(null);
    on(event: string, cb: Function) {
      (this.handlers[event] ??= []).push(cb);
      return this;
    }
    once(event: string, cb: Function) {
      const wrapper = (...args: any[]) => {
        // remove wrapper before calling
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
        try {
          cb(...args);
        } catch {
          // Real busboy is resilient; ignore handler errors to let stream continue
        }
      }
    }
  }
  return function busboyFactory() {
    return new FakeBusboy();
  };
});

import {
  parseMultipartInput,
  type MultipartRequest,
} from "../../exposure/multipart";
import { getDefaultSerializer } from "../../../serializer";
import type { JsonResponse } from "../../exposure/types";

const serializer = getDefaultSerializer();

function expectErrorCode(response: JsonResponse, expected: string): void {
  const body = response.body;
  expect(body && typeof body === "object").toBe(true);
  if (!body || typeof body !== "object") return;
  const error = (body as { error?: unknown }).error;
  expect(error && typeof error === "object").toBe(true);
  if (!error || typeof error !== "object") return;
  const code = (error as { code?: unknown }).code;
  expect(typeof code).toBe("string");
  expect(code).toBe(expected);
}

type FakeBusboy = NodeJS.WritableStream & {
  emit: (event: string, ...args: unknown[]) => void;
};

type MockRequest = MultipartRequest & PassThrough;

const isFakeBusboy = (value: NodeJS.WritableStream): value is FakeBusboy =>
  !!value && typeof (value as { emit?: unknown }).emit === "function";

function createMockRequest(
  headers: IncomingHttpHeaders,
  scenario: (busboy: FakeBusboy, req: MockRequest) => void,
): MultipartRequest {
  class MockMultipartRequest extends PassThrough implements MultipartRequest {
    headers: IncomingHttpHeaders;
    method?: string;

    constructor() {
      super();
      this.headers = headers;
      this.method = "POST";
    }

    pipe<T extends NodeJS.WritableStream>(
      destination: T,
      options?: { end?: boolean },
    ): T {
      if (isFakeBusboy(destination)) {
        // Execute provided scenario to simulate busboy behavior
        scenario(destination, this);
        return destination;
      }
      return super.pipe(destination, options);
    }
  }

  return new MockMultipartRequest();
}

type FakeStream = {
  on: (event: string, cb: (...args: unknown[]) => void) => FakeStream;
  pipe: (dest?: unknown) => void;
  resume: () => void;
};

describe("parseMultipartInput - extra mocked branches", () => {
  const boundary = "----unit-mock-boundary";
  const baseHeaders = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
  } as const;

  it("field '__manifest' with non-object JSON triggers MISSING_MANIFEST in field handler", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      // Emit a manifest that parses to a primitive (string), not an object
      busboy.emit("field", "__manifest", '"hello"', {});
      // Completion afterwards shouldn't matter (fail happens in field handler)
      busboy.emit("finish");
    });

    const result = await parseMultipartInput(req, undefined, serializer);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "MISSING_MANIFEST");
  });

  it("field '__manifest' empty string hits ternary falsy branch and MISSING_MANIFEST", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      busboy.emit("field", "__manifest", "", {});
      busboy.emit("finish");
    });

    const result = await parseMultipartInput(req, undefined, serializer);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "MISSING_MANIFEST");
  });

  it("file stream emits error triggers STREAM_ERROR", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      // Provide a matching file:* entry that will error when piped
      const fileStream: FakeStream = {
        on(event: string, cb: Function) {
          if (event === "error") {
            // Trigger error asynchronously to mimic real streams
            setImmediate(() => cb(new Error("boom")));
          }
          return fileStream;
        },
        pipe() {},
        resume() {},
      };
      busboy.emit("file", "file:ID1", fileStream, {
        filename: "a.txt",
        mimeType: "text/plain",
      });
    });

    const result = await parseMultipartInput(req, undefined, serializer);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "STREAM_ERROR");
  });

  it("enforces files limit when manifest references too many file ids", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      const manifest = JSON.stringify({
        input: {
          a: { $runnerFile: "File", id: "F1" },
          b: { $runnerFile: "File", id: "F2" },
        },
      });
      busboy.emit("field", "__manifest", manifest, {});
    });

    const result = await parseMultipartInput(req, undefined, serializer, {
      files: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "PAYLOAD_TOO_LARGE");
  });

  it("fails when file handler hits files limit and resumes the stream", async () => {
    const resumeSpy = jest.fn();
    const req = createMockRequest(baseHeaders, (busboy) => {
      const mkStream = () => ({
        on() {
          return this;
        },
        pipe() {},
        resume: resumeSpy,
      });
      busboy.emit("file", "file:F1", mkStream(), {
        filename: "a.txt",
        mimeType: "text/plain",
      });
      busboy.emit("file", "file:F2", mkStream(), {
        filename: "b.txt",
        mimeType: "text/plain",
      });
    });

    const result = await parseMultipartInput(req, undefined, serializer, {
      files: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "PAYLOAD_TOO_LARGE");
    expect(resumeSpy).toHaveBeenCalled();
  });

  it("surfaces unknown file handler errors while completing the request", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      const badInfo: FileInfo = {
        get filename(): string {
          throw new Error("boom");
        },
        encoding: "7bit",
        mimeType: "text/plain",
      };
      const fileStream: FakeStream = {
        on() {
          return this;
        },
        pipe() {},
        resume() {},
      };
      busboy.emit("file", "file:F1", fileStream, badInfo);
      busboy.emit("finish");
    });

    const result = await parseMultipartInput(req, undefined, serializer);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "MISSING_MANIFEST");
  });

  it("falls back to ending streams if destroy throws", async () => {
    const originalDestroy = PassThrough.prototype.destroy;
    const originalEnd = PassThrough.prototype.end;
    type EndFn = (
      this: PassThrough,
      chunk?: any,
      encodingOrCb?: BufferEncoding | (() => void),
      cb?: () => void,
    ) => PassThrough;
    const endWithCallback: EndFn = originalEnd;
    let ended = false;
    PassThrough.prototype.destroy = function destroy() {
      throw new Error("nope");
    };
    PassThrough.prototype.end = function end(
      this: PassThrough,
      chunk?: any,
      encodingOrCb?: BufferEncoding | (() => void),
      cb?: () => void,
    ) {
      ended = true;
      if (typeof encodingOrCb === "function") {
        return endWithCallback.call(this, chunk, encodingOrCb);
      }
      return endWithCallback.call(this, chunk, encodingOrCb, cb);
    };

    try {
      const req = createMockRequest(baseHeaders, (busboy) => {
        const manifest = JSON.stringify({
          input: { f: { $runnerFile: "File", id: "F1" } },
        });
        busboy.emit("field", "__manifest", manifest, {});
        busboy.emit("finish");
      });

      await parseMultipartInput(req, undefined, serializer);
      expect(ended).toBe(true);
    } finally {
      PassThrough.prototype.destroy = originalDestroy;
      PassThrough.prototype.end = originalEnd;
    }
  });

  it("applies field size limit before parsing the manifest", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      busboy.emit("field", "__manifest", "12345", {});
    });

    const result = await parseMultipartInput(req, undefined, serializer, {
      fieldSize: 4,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "PAYLOAD_TOO_LARGE");
  });

  it("busboy emits error triggers INVALID_MULTIPART (once handler)", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      // Trigger busboy error path
      setImmediate(() => busboy.emit("error", new Error("bad")));
    });

    const result = await parseMultipartInput(req, undefined, serializer);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "INVALID_MULTIPART");
  });

  it("file info can set size/lastModified/extra via 'file' source (branch)", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      const fileStream: FakeStream = {
        on() {
          return fileStream;
        },
        pipe() {},
        resume() {},
      };
      // Include extra fields on info to drive 'file' source meta paths
      const info: FileInfo & {
        size?: number;
        lastModified?: number;
        extra?: Record<string, unknown>;
      } = {
        filename: "z.bin",
        encoding: "7bit",
        mimeType: "application/octet-stream",
        size: 123,
        lastModified: 456,
        extra: { k: 1 },
      };
      busboy.emit("file", "file:FZ", fileStream, info);
      // End with an error to flush readyPromise
      busboy.emit("error", new Error("stop"));
    });

    const result = await parseMultipartInput(req, undefined, serializer);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "INVALID_MULTIPART");
  });

  it("handleCompletion INVALID_MULTIPART when field handler throws before try (manifestSeen=true)", async () => {
    const badValue: { [Symbol.toPrimitive]: () => string } = {
      [Symbol.toPrimitive]: (): string => {
        throw new Error("coercion-error");
      },
    };
    const req = createMockRequest(baseHeaders, (busboy) => {
      // Our FakeBusboy.emit swallows handler errors, simulating robust emitter behavior
      busboy.emit("field", "__manifest", badValue, {});
      // Completion after handler error should see manifestSeen=true but not resolved
      busboy.emit("finish");
    });

    const result = await parseMultipartInput(req, undefined, serializer);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "INVALID_MULTIPART");
  });
});
