import type { IncomingHttpHeaders } from "http";

import { getDefaultSerializer } from "../../../../serializer";

enum MultipartHeaderName {
  ContentType = "content-type",
}

enum MultipartMimeType {
  FormData = "multipart/form-data",
  PlainText = "text/plain",
}

enum MultipartFieldName {
  Manifest = "__manifest",
}

enum FileId {
  F1 = "F1",
}

enum ErrorMessage {
  Boom = "boom",
}

function createMockRequest(
  headers: IncomingHttpHeaders,
  scenario: (busboy: any) => void,
): any {
  const req: any = {
    headers,
    method: "POST" as const,
    on() {
      return req;
    },
    unpipe() {},
    resume() {},
    pipe(busboy: any) {
      scenario(busboy);
      return req;
    },
  };
  return req;
}

describe("parseMultipartInput - unexpected file handler errors", () => {
  it("rethrows non-limit errors from the file handler", async () => {
    jest.resetModules();

    jest.doMock("busboy", () => {
      class FakeBusboy {
        private handlers: Record<string, Function[]> = Object.create(null);

        on(event: string, cb: Function) {
          (this.handlers[event] ??= []).push(cb);
          return this;
        }

        once(event: string, cb: Function) {
          (this.handlers[event] ??= []).push(cb);
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
        default: (_cfg: { headers: IncomingHttpHeaders }) => new FakeBusboy(),
      };
    });

    jest.doMock("../../../files/inputFile.model", () => {
      class NodeInputFile {
        constructor() {
          throw new Error(ErrorMessage.Boom);
        }
      }
      return { NodeInputFile };
    });

    const { PassThrough } = require("node:stream");
    const { parseMultipartInput } = require("../../../exposure/multipart");

    const boundary = "----unit-busboy-default-boundary-unexpected";
    const serializer = getDefaultSerializer();
    const req = createMockRequest(
      {
        [MultipartHeaderName.ContentType]: `${MultipartMimeType.FormData}; boundary=${boundary}`,
      },
      (busboy) => {
        const upstream = new PassThrough();
        busboy.emit("file", `file:${FileId.F1}`, upstream, {
          filename: "a.txt",
          mimeType: MultipartMimeType.PlainText,
          encoding: "7bit",
        });
        upstream.end();
        busboy.emit("field", MultipartFieldName.Manifest, "{}", {
          nameTruncated: false,
          valueTruncated: false,
          encoding: "7bit",
          mimeType: MultipartMimeType.PlainText,
        });
        busboy.emit("finish");
      },
    );

    await expect(
      parseMultipartInput(req, undefined, serializer),
    ).rejects.toThrow(ErrorMessage.Boom);
  });
});
