import type { IncomingMessage, ServerResponse } from "http";

import { createTaskHandler } from "../../../exposure/handlers/taskHandler";
import { getDefaultSerializer } from "../../../../serializer";
import * as multipartModule from "../../../exposure/multipart";
import * as requestBodyModule from "../../../exposure/requestBody";
import * as errorHandlers from "../../../exposure/handlers/errorHandlers";

enum TaskId {
  T = "t",
}

enum ContentTypeHeader {
  Name = "content-type",
}

enum ContentType {
  Json = "application/json",
  Multipart = "multipart/form-data; boundary=abc",
}

enum UrlPath {
  X = "/x",
}

enum RouterBasePath {
  X = "/x",
}

enum ErrorMessage {
  Boom = "boom",
}

enum CustomResponseBody {
  Custom = "custom",
}

function createReq(contentType: ContentType): IncomingMessage {
  const req: any = {
    method: "POST",
    url: UrlPath.X,
    headers: { [ContentTypeHeader.Name]: contentType },
    on(..._args: any[]) {
      return req;
    },
    once(..._args: any[]) {
      return req;
    },
  };
  return req;
}

function createRes(): ServerResponse & {
  endCalls: number;
  writableEnded: boolean;
  headersSent: boolean;
  body?: Buffer;
} {
  const res: any = {
    statusCode: 0,
    endCalls: 0,
    writableEnded: false,
    headersSent: false,
    setHeader() {},
    on(..._args: any[]) {
      return res;
    },
    once(..._args: any[]) {
      return res;
    },
    end(buf?: unknown) {
      res.endCalls += 1;
      res.writableEnded = true;
      res.headersSent = true;
      if (buf != null) {
        res.body = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
      }
    },
  };
  return res;
}

describe("taskHandler", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("finalizes multipart and reports task errors via handleRequestError", async () => {
    const serializer = getDefaultSerializer();
    const handleRequestErrorSpy = jest.spyOn(
      errorHandlers,
      "handleRequestError",
    );
    jest.spyOn(multipartModule, "isMultipart").mockReturnValue(true);
    jest.spyOn(multipartModule, "parseMultipartInput").mockResolvedValue({
      ok: true,
      value: { input: 1 },
      finalize: Promise.resolve({ ok: true }),
    });

    const res = createRes();
    const taskRunner = {
      run: async () => {
        throw new Error(ErrorMessage.Boom);
      },
    };

    const handler = createTaskHandler({
      store: {
        tasks: new Map([[TaskId.T, { task: { id: TaskId.T } }]]),
        errors: new Map(),
      } as any,
      taskRunner: taskRunner as any,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      } as any,
      authenticator: async () => ({ ok: true as const }),
      allowList: { ensureTask: () => null } as any,
      router: { basePath: RouterBasePath.X },
      cors: undefined,
      serializer,
      limits: undefined,
    });

    const req = createReq(ContentType.Multipart);
    await handler(req, res, TaskId.T);

    expect(handleRequestErrorSpy).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(500);
  });

  it("does not write a default JSON envelope when the task already wrote a response", async () => {
    const serializer = getDefaultSerializer();
    jest
      .spyOn(requestBodyModule, "readJsonBody")
      .mockResolvedValue({ ok: true, value: { input: 1 } });

    const res = createRes();
    const taskRunner = {
      run: async () => {
        res.statusCode = 201;
        res.end(Buffer.from(CustomResponseBody.Custom));
        return { ok: true };
      },
    };

    const handler = createTaskHandler({
      store: {
        tasks: new Map([[TaskId.T, { task: { id: TaskId.T } }]]),
        errors: new Map(),
      } as any,
      taskRunner: taskRunner as any,
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      } as any,
      authenticator: async () => ({ ok: true as const }),
      allowList: { ensureTask: () => null } as any,
      router: { basePath: RouterBasePath.X },
      cors: undefined,
      serializer,
      limits: undefined,
    });

    const req = createReq(ContentType.Json);
    await handler(req, res, TaskId.T);

    expect(res.endCalls).toBe(1);
    expect(res.statusCode).toBe(201);
  });
});
