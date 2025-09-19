import type { IncomingHttpHeaders } from "http";

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
        this.handlers[event] = (this.handlers[event] ?? []).filter((f) => f !== wrapper);
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

import { parseMultipartInput, type MultipartRequest } from "../exposure/multipart";
import type { JsonResponse } from "../exposure/types";

function expectErrorCode(response: JsonResponse, expected: string): void {
  const body = response.body as any;
  expect(typeof body).toBe("object");
  expect(typeof body?.error?.code).toBe("string");
  expect(body.error.code).toBe(expected);
}

function createMockRequest(
  headers: IncomingHttpHeaders,
  scenario: (busboy: any, req: any) => void,
): MultipartRequest {
  const req: any = {
    headers,
    method: "POST" as const,
    on() {
      // parseMultipartInput attaches an 'error' listener; we ignore here
      return req;
    },
    unpipe() {},
    resume() {},
    pipe(busboy: any) {
      // Execute provided scenario to simulate busboy behavior
      scenario(busboy, req);
      return req;
    },
  };
  return req;
}

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

    const result = await parseMultipartInput(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "MISSING_MANIFEST");
  });

  it("field '__manifest' empty string hits ternary falsy branch and MISSING_MANIFEST", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      busboy.emit("field", "__manifest", "", {});
      busboy.emit("finish");
    });

    const result = await parseMultipartInput(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "MISSING_MANIFEST");
  });

  it("file stream emits error triggers STREAM_ERROR", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      // Provide a matching file:* entry that will error when piped
      const fileStream: any = {
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
      busboy.emit("file", "file:ID1", fileStream, { filename: "a.txt", mimeType: "text/plain" });
    });

    const result = await parseMultipartInput(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "STREAM_ERROR");
  });

  it("busboy emits error triggers INVALID_MULTIPART (once handler)", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      // Trigger busboy error path
      setImmediate(() => busboy.emit("error", new Error("bad")));
    });

    const result = await parseMultipartInput(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "INVALID_MULTIPART");
  });

  it("file info can set size/lastModified/extra via 'file' source (branch)", async () => {
    const req = createMockRequest(baseHeaders, (busboy) => {
      const fileStream: any = {
        on() { return fileStream; },
        pipe() {},
        resume() {},
      };
      // Include extra fields on info to drive 'file' source meta paths
      busboy.emit("file", "file:FZ", fileStream, {
        filename: "z.bin",
        mimeType: "application/octet-stream",
        size: 123,
        lastModified: 456,
        extra: { k: 1 },
      } as any);
      // End with an error to flush readyPromise
      busboy.emit("error", new Error("stop"));
    });

    const result = await parseMultipartInput(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "INVALID_MULTIPART");
  });

  it("handleCompletion INVALID_MULTIPART when field handler throws before try (manifestSeen=true)", async () => {
    const badValue: any = {
      [Symbol.toPrimitive]: () => {
        throw new Error("coercion-error");
      },
    };
    const req = createMockRequest(baseHeaders, (busboy) => {
      // Our FakeBusboy.emit swallows handler errors, simulating robust emitter behavior
      busboy.emit("field", "__manifest", badValue, {});
      // Completion after handler error should see manifestSeen=true but not resolved
      busboy.emit("finish");
    });

    const result = await parseMultipartInput(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expectErrorCode(result.response, "INVALID_MULTIPART");
  });
});
