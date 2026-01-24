import type { IncomingHttpHeaders } from "http";
import { PassThrough } from "node:stream";
import { type MultipartRequest } from "../../../exposure/multipart";
import type { JsonResponse } from "../../../exposure/types";

// We mock busboy logic here to be used in multiple test files
export const setupBusboyMock = () => {
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
          try {
            cb(...args);
          } catch {
            // Real busboy is resilient; ignore handler errors
          }
        }
      }
    }
    return function busboyFactory() {
      return new FakeBusboy();
    };
  });
};

export function expectErrorCode(
  response: JsonResponse,
  expected: string,
): void {
  const body = response.body;
  if (!body || typeof body !== "object") throw new Error("Missing body");
  const error = (body as { error?: any }).error;
  if (!error || typeof error !== "object") throw new Error("Missing error");
  expect(error.code).toBe(expected);
}

export type FakeBusboy = NodeJS.WritableStream & {
  emit: (event: string, ...args: unknown[]) => void;
};

export type MockRequest = MultipartRequest & PassThrough;

const isFakeBusboy = (value: NodeJS.WritableStream): value is FakeBusboy =>
  !!value && typeof (value as { emit?: unknown }).emit === "function";

export function createMockRequest(
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
        scenario(destination, this);
        return destination;
      }
      return super.pipe(destination, options);
    }
  }

  return new MockMultipartRequest();
}

export type FakeStream = {
  on: (event: string, cb: (...args: unknown[]) => void) => FakeStream;
  pipe: (dest?: unknown) => void;
  resume: () => void;
};
