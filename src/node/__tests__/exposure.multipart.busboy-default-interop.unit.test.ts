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
} from "../exposure/multipart";
import { getDefaultSerializer } from "../../serializer";

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
        busboy.emit("field", "__manifest", JSON.stringify({ input: { a: 1 } }), {
          nameTruncated: false,
          valueTruncated: false,
          encoding: "7bit",
          mimeType: "text/plain",
        });
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
});

